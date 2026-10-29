/**
 * Login-session API-key broker for the existing enterprise identity service
 * and New API. It owns New API management credentials; callers only present
 * their already-issued enterprise access token.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be configured`)
  return value
}
const config = {
  listenHost: process.env.BROKER_LISTEN_HOST ?? '127.0.0.1',
  listenPort: Number(process.env.BROKER_LISTEN_PORT ?? '4010'),
  dataFile: required('BROKER_DATA_FILE'),
  externalBase: required('EXTERNAL_API_BASE_URL').replace(/\/$/, ''),
  newApiBase: required('NEW_API_BASE_URL').replace(/\/$/, ''),
  rootUsername: required('NEW_API_ROOT_USERNAME'),
  rootPassword: required('NEW_API_ROOT_PASSWORD'),
  maxSessionSeconds: Number(process.env.BROKER_MAX_SESSION_SECONDS ?? '2592000'),
  enterpriseQuota: Number(process.env.BROKER_ENTERPRISE_QUOTA ?? '9007199254740991'),
}
if (!Number.isSafeInteger(config.listenPort) || config.listenPort < 1 || config.listenPort > 65535) throw new Error('BROKER_LISTEN_PORT is invalid')
if (!Number.isSafeInteger(config.maxSessionSeconds) || config.maxSessionSeconds < 1) throw new Error('BROKER_MAX_SESSION_SECONDS is invalid')
if (!Number.isSafeInteger(config.enterpriseQuota) || config.enterpriseQuota < 1) throw new Error('BROKER_ENTERPRISE_QUOTA is invalid')

let state = { enterprises: {}, sessions: {} }
let writeQueue = Promise.resolve()
const nowSeconds = () => Math.floor(Date.now() / 1000)
const fingerprint = (value) => createHash('sha256').update(value).digest('hex')
const safeLabel = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 20)
const json = (status, value) => ({ status, body: JSON.stringify(value) })

async function loadState() {
  try {
    const decoded = JSON.parse(await readFile(config.dataFile, 'utf8'))
    if (!decoded || typeof decoded !== 'object' || typeof decoded.enterprises !== 'object' || typeof decoded.sessions !== 'object') throw new Error('invalid broker state')
    state = decoded
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await persist()
  }
}
function persist() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(config.dataFile), { recursive: true, mode: 0o700 })
    const temp = `${config.dataFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, config.dataFile)
  })
  return writeQueue
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  let payload
  try { payload = await response.json() } catch { throw new Error(`Non-JSON response from ${new URL(url).origin}`) }
  if (!response.ok || payload?.success === false || payload?.code && payload.code !== 200) {
    const detail = payload?.message ?? payload?.msg
    const message = detail ? String(detail) : `HTTP ${response.status}`
    const error = new Error(response.ok ? message : (detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`))
    error.status = response.status
    throw error
  }
  return payload?.data ?? payload
}
function headers(token, userId) {
  return { Authorization: `Bearer ${token}`, 'New-Api-User': String(userId), 'Content-Type': 'application/json' }
}
async function loginNewApi(username, password) {
  const payload = await requestJson(`${config.newApiBase}/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  })
  if (typeof payload.access_token !== 'string' || !Number.isInteger(payload.user?.id)) throw new Error('New API login returned no usable session')
  return { token: payload.access_token, userId: payload.user.id }
}
async function rootSession() { return loginNewApi(config.rootUsername, config.rootPassword) }
async function validateEnterpriseToken(token) {
  const payload = await requestJson(`${config.externalBase}/system/user/getInfo`, { headers: { Authorization: token } })
  const enterprise = payload.enterprise
  const user = payload.user
  if (typeof enterprise?.id !== 'string' || enterprise.id === '' || typeof user?.id !== 'string' || user.id === '') throw new Error('Identity response has no enterprise or user identifier')
  return { enterpriseId: enterprise.id, enterpriseName: enterprise.name || enterprise.id, userId: user.id, userName: user.userName || user.id }
}
async function findNewApiUser(root, username) {
  const result = await requestJson(`${config.newApiBase}/api/user/search?keyword=${encodeURIComponent(username)}&p=0&page_size=20`, { headers: headers(root.token, root.userId) })
  const rows = result.items ?? []
  return rows.find((row) => row.username === username) ?? null
}
async function provisionEnterprise(identity) {
  const existing = state.enterprises[identity.enterpriseId]
  const root = await rootSession()
  if (existing) return { ...existing, root }
  const username = `ent_${fingerprint(identity.enterpriseId).slice(0, 16)}`
  let account = await findNewApiUser(root, username)
  const password = randomBytes(32).toString('base64url')
  if (account) {
    throw new Error('The New API enterprise account exists without broker state; recover its broker credential before provisioning')
  }
  {
    await requestJson(`${config.newApiBase}/api/user/`, {
      method: 'POST', headers: headers(root.token, root.userId),
      body: JSON.stringify({ username, password, display_name: safeLabel(identity.enterpriseName), role: 1 }),
    })
    account = await findNewApiUser(root, username)
    if (!account) throw new Error('New API did not return the enterprise account it created')
  }
  const stored = { newApiUserId: account.id, username, password, enterpriseName: identity.enterpriseName }
  state.enterprises[identity.enterpriseId] = stored
  await requestJson(`${config.newApiBase}/api/user/manage`, {
    method: 'POST', headers: headers(root.token, root.userId),
    body: JSON.stringify({ id: account.id, action: 'add_quota', mode: 'override', value: config.enterpriseQuota }),
  })
  await persist()
  return { ...stored, root }
}
async function tokenSession(enterprise) { return loginNewApi(enterprise.username, enterprise.password) }
async function listTokens(session) {
  const payload = await requestJson(`${config.newApiBase}/api/token/?p=0&page_size=100`, { headers: headers(session.token, session.userId) })
  return payload.items ?? []
}
async function issue(token, requestedSeconds) {
  const identity = await validateEnterpriseToken(token)
  const tokenHash = fingerprint(token)
  const timestamp = nowSeconds()
  if (!Number.isSafeInteger(requestedSeconds) || requestedSeconds < 1) throw new Error('expiresIn must be a positive integer')
  const known = state.sessions[tokenHash]
  if (known && known.expiresAt <= timestamp) throw new Error('The enterprise login session has expired')
  const expiresAt = known?.expiresAt ?? timestamp + Math.min(requestedSeconds, config.maxSessionSeconds)
  const enterprise = await provisionEnterprise(identity)
  const session = await tokenSession(enterprise)
  const name = known?.newApiTokenName ?? `usr_${safeLabel(identity.userId)}_${tokenHash.slice(0, 8)}`
  let row = (await listTokens(session)).find((item) => item.name === name)
  if (!row) {
    try {
      await requestJson(`${config.newApiBase}/api/token/`, {
        method: 'POST', headers: headers(session.token, session.userId),
        // -1 = never expire on New API; broker still enforces expiresAt locally.
        body: JSON.stringify({ name, expired_time: -1, unlimited_quota: true, group: 'default' }),
      })
    } catch (error) {
      if (!String(error?.message ?? error).includes('409')) throw error
    }
    row = (await listTokens(session)).find((item) => item.name === name)
  }
  if (!row?.id) {
    name = `${name}_${randomBytes(3).toString('hex')}`
    await requestJson(`${config.newApiBase}/api/token/`, {
      method: 'POST', headers: headers(session.token, session.userId),
      body: JSON.stringify({ name, expired_time: -1, unlimited_quota: true, group: 'default' }),
    })
    row = (await listTokens(session)).find((item) => item.name === name)
  }
  if (!row?.id) throw new Error('New API did not return the user token it created')
  const revealed = await requestJson(`${config.newApiBase}/api/token/${row.id}/key`, { method: 'POST', headers: headers(session.token, session.userId) })
  if (typeof revealed.key !== 'string' || revealed.key === '') throw new Error('New API did not reveal the user token')
  state.sessions[tokenHash] = { enterpriseId: identity.enterpriseId, externalUserId: identity.userId, newApiUserId: enterprise.newApiUserId, newApiTokenId: row.id, newApiTokenName: name, expiresAt }
  await persist()
  return { apiKey: `sk-${revealed.key}`, expiresAt: expiresAt * 1000, enterpriseId: identity.enterpriseId, userId: identity.userId }
}

async function status(token) {
  const identity = await validateEnterpriseToken(token)
  const known = state.sessions[fingerprint(token)]
  if (!known || known.enterpriseId !== identity.enterpriseId || known.externalUserId !== identity.userId) {
    return { active: false, reason: 'key_not_issued' }
  }
  if (known.expiresAt <= nowSeconds()) return { active: false, reason: 'key_expired', expiresAt: known.expiresAt * 1000 }
  return { active: true, reason: undefined, expiresAt: known.expiresAt * 1000 }
}

async function revoke(token) {
  const identity = await validateEnterpriseToken(token)
  const tokenHash = fingerprint(token)
  const known = state.sessions[tokenHash]
  if (!known || known.enterpriseId !== identity.enterpriseId || known.externalUserId !== identity.userId) return { revoked: false }
  const enterprise = state.enterprises[identity.enterpriseId]
  if (!enterprise) throw new Error('Broker state is missing the enterprise account')
  const session = await tokenSession(enterprise)
  await requestJson(`${config.newApiBase}/api/token/${known.newApiTokenId}`, { method: 'DELETE', headers: headers(session.token, session.userId) })
  delete state.sessions[tokenHash]
  await persist()
  return { revoked: true }
}

async function parseRequest(request) {
  const chunks = []
  for await (const chunk of request) { chunks.push(chunk); if (Buffer.concat(chunks).length > 16_384) throw new Error('Request body is too large') }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function enterpriseToken(request) {
  const value = request.headers.authorization
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Authorization is required')
  return value.trim()
}
function respond(request, response, result) {
  response.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  })
  response.end(result.body)
}
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return respond(request, response, { status: 204, body: '' })
    if (request.method === 'GET' && request.url === '/healthz') return respond(request, response, json(200, { ok: true }))
    if (request.method !== 'POST') return respond(request, response, json(404, { error: 'not_found' }))
    const token = enterpriseToken(request)
    if (request.url === '/v1/session/issue') {
      const body = await parseRequest(request)
      return respond(request, response, json(200, await issue(token, Number(body.expiresIn))))
    }
    if (request.url === '/v1/session/status') return respond(request, response, json(200, await status(token)))
    if (request.url === '/v1/session/revoke') return respond(request, response, json(200, await revoke(token)))
    return respond(request, response, json(404, { error: 'not_found' }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    const status = /Authorization|required|expired|Identity response/.test(message) ? 401 : 502
    return respond(request, response, json(status, { error: status === 401 ? 'identity_invalid' : 'provisioning_failed', message }))
  }
})

await loadState()
server.listen(config.listenPort, config.listenHost, () => console.log(`t4y-key-broker listening on ${config.listenHost}:${config.listenPort}`))

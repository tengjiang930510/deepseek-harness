/**
 * Host-side mobile enter: enterprise auth → host picker → pairing token.
 * Multi-phone / multi-PC: phone only lists PCs where the same account is logged in.
 */
import { createHash, publicEncrypt, randomBytes, constants as cryptoConstants } from 'node:crypto'
import { readFile, writeFile, mkdir, rename as renameFile } from 'node:fs/promises'
import { hostname as osHostname } from 'node:os'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const MODEL_CREDENTIAL_REF = 'T4Y_NEW_API_KEY'
const PAIR_TTL_MS = 120_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
/** Same default as t4y-identity Host (avoid looping through Web-authed /api proxy). */
const DEFAULT_API_BASE_URL = 'https://jgyw.crfsdi.com.cn:51010/backendapi'

/** @type {Map<string, { count: number, resetAt: number }>} */
const loginAttempts = new Map()

/**
 * @returns {string}
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  return join(homedir(), '.dsh')
}

/**
 * @param {unknown} value
 * @returns {Response}
 */
export function enterJson(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function takeLoginSlot(key) {
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (current.count >= RATE_MAX) return false
  current.count += 1
  return true
}

/**
 * @param {string} spkiB64
 * @returns {string}
 */
function spkiB64ToPem(spkiB64) {
  const compact = spkiB64.replace(/\s+/g, '')
  const lines = compact.match(/.{1,64}/g) || []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

/**
 * @param {string} spkiB64
 * @param {string} password
 * @returns {string}
 */
function encryptPassword(spkiB64, password) {
  const encrypted = publicEncrypt(
    {
      key: spkiB64ToPem(spkiB64),
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password, 'utf8'),
  )
  return encrypted.toString('base64')
}

/**
 * @param {import('cordis').Context} ctx
 * @returns {string}
 */
function resolveApiBaseUrl(ctx) {
  try {
    const configured = ctx.scope?.config?.apiBaseUrl
      ?? ctx.config?.apiBaseUrl
    if (typeof configured === 'string' && configured.trim() !== '') {
      return configured.trim().replace(/\/$/u, '')
    }
  } catch {
    // optional
  }
  const fromEnv = process.env.T4Y_API_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/$/u, '')
  }
  return DEFAULT_API_BASE_URL
}

/**
 * @param {import('cordis').Context} ctx
 * @param {string} path
 * @param {string} method
 * @param {string | undefined} body
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<{ ok: boolean, status: number, json: any }>}
 */
async function callEnterpriseApi(ctx, path, method, body, extraHeaders = {}) {
  const url = `${resolveApiBaseUrl(ctx)}${path}`
  const headers = {
    Accept: 'application/json, text/plain, */*',
    browser: 'Safari',
    'operating-system': 'Mac/iOS',
    'operator-type': 'PC',
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...extraHeaders,
  }
  /** FRP / 上游偶发抖动：最多 3 次，避免入口页频繁「网络异常」。 */
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(30_000),
      })
      let json
      try {
        json = await response.json()
      } catch {
        json = null
      }
      // 5xx / 空体再试；业务 4xx（错密等）直接返回。
      if (response.status >= 500 || (response.ok && json == null)) {
        lastError = new Error(`upstream_${response.status}`)
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
      return { ok: response.ok, status: response.status, json }
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  if (lastError) throw lastError
  return { ok: false, status: 502, json: null }
}

/**
 * @returns {Promise<object | null>}
 */
export async function readHostSession() {
  try {
    const raw = await readFile(join(dshHome(), 't4y-identity', 'host-session.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const session = parsed?.session && typeof parsed.session === 'object' ? parsed.session : parsed
    if (!session || typeof session !== 'object') return null
    if (typeof session.accessToken !== 'string' || session.accessToken === '') return null
    if (typeof session.expiresAt === 'number' && session.expiresAt <= Date.now()) return null
    if (session.needsModulePick === true) return null
    if (typeof session.moduleId !== 'string' || session.moduleId === '') return null
    return session
  } catch {
    return null
  }
}

/**
 * @param {string} enterpriseName
 * @param {string} userName
 * @returns {string}
 */
export function accountKeyOf(enterpriseName, userName) {
  const ent = enterpriseName.trim().toLowerCase()
  const user = userName.trim().toLowerCase()
  return createHash('sha256').update(`${ent}\n${user}`).digest('hex').slice(0, 32)
}

/**
 * Rule B: phone account must match the PC host-session account.
 * @param {object} hostSession
 * @param {string} userName
 * @param {string} enterpriseName
 * @returns {boolean}
 */
export function sameAccount(hostSession, userName, enterpriseName) {
  const wantUser = userName.trim().toLowerCase()
  const haveUser = String(hostSession.username || '').trim().toLowerCase()
  if (wantUser === '' || haveUser === '' || wantUser !== haveUser) return false
  const wantEnt = enterpriseName.trim()
  const haveEnt = String(hostSession.enterpriseName || '').trim()
  if (wantEnt !== '' && haveEnt !== '' && wantEnt !== haveEnt) return false
  return true
}

/**
 * @returns {Promise<string>}
 */
async function stableHostId() {
  const file = join(dshHome(), 'mobile-access', 't4y-host-id.txt')
  try {
    const raw = (await readFile(file, 'utf8')).trim()
    if (/^[a-f\d]{16,64}$/i.test(raw)) return raw.toLowerCase()
  } catch {
    // create below
  }
  const id = randomBytes(16).toString('hex')
  try {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temporary, `${id}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await renameFile(temporary, file)
  } catch {
    // concurrent create — re-read
    try {
      const raw = (await readFile(file, 'utf8')).trim()
      if (raw) return raw.toLowerCase()
    } catch { /* keep generated */ }
  }
  return id
}

/**
 * @returns {Promise<string | null>}
 */
async function readConfiguredPublicOrigin() {
  try {
    const raw = await readFile(join(dshHome(), 'mobile-access', 'remote', 'frp', 'config', 'frpc.toml'), 'utf8')
    const match = raw.match(/publicOrigin\s*=\s*"([^"]+)"/i)
      || raw.match(/customDomains\s*=\s*\["([^"]+)"\]/)
    if (match?.[1]) {
      const value = match[1].trim()
      if (value.startsWith('https://') || value.startsWith('http://')) return value.replace(/\/$/u, '')
      return `https://${value.replace(/\/$/u, '')}`
    }
  } catch {
    // optional
  }
  try {
    const raw = await readFile(join(dshHome(), 'mobile-access', 'remote', 'frp', 'config', 'state.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const origin = parsed?.publicOrigin || parsed?.configuration?.publicOrigin
    if (typeof origin === 'string' && origin.startsWith('http')) return origin.replace(/\/$/u, '')
  } catch {
    // optional
  }
  return null
}

/**
 * @param {boolean} accepting
 * @param {string | null} [requestOrigin]
 * @returns {Promise<object | null>}
 */
export async function buildSelfHostCard(accepting, requestOrigin = null) {
  const hostSession = await readHostSession()
  if (!hostSession) return null
  const userName = String(hostSession.username || '').trim()
  const enterpriseName = String(hostSession.enterpriseName || '').trim()
  if (userName === '') return null
  const id = await stableHostId()
  const configured = await readConfiguredPublicOrigin()
  const origin = (configured || requestOrigin || '').replace(/\/$/u, '')
  if (origin === '') return null
  const label = [
    String(hostSession.displayName || '').trim(),
    osHostname(),
  ].filter(Boolean).join(' · ') || osHostname() || '电脑'
  return {
    id,
    label,
    origin,
    accountKey: accountKeyOf(enterpriseName, userName),
    accepting: accepting === true,
    online: true,
  }
}

/**
 * @param {Set<object>} accessControllers
 * @returns {Promise<{ token: string, expiresAt: number } | null>}
 */
async function openPairingToken(accessControllers) {
  for (const controller of [...accessControllers]) {
    if (typeof controller?.openPairing !== 'function') continue
    try {
      const opened = await controller.openPairing(PAIR_TTL_MS)
      if (opened && typeof opened.token === 'string' && opened.token !== '') {
        return { token: opened.token, expiresAt: opened.expiresAt }
      }
    } catch {
      // try next controller
    }
  }
  return null
}

/**
 * @param {object} hostSession
 * @param {import('cordis').Context} ctx
 * @returns {Promise<{ session: object, modelKeyPresent: boolean }>}
 */
export async function buildPublicHostReady(hostSession, ctx) {
  let modelKeyPresent = false
  try {
    const resolved = await ctx.credentials.resolve(MODEL_CREDENTIAL_REF)
    modelKeyPresent = typeof resolved?.value === 'string' && resolved.value !== ''
  } catch {
    modelKeyPresent = false
  }
  if (!modelKeyPresent && typeof hostSession.llmApiKeyExpiresAt === 'number') {
    modelKeyPresent = hostSession.llmApiKeyExpiresAt > Date.now()
  }

  const tenantId = typeof hostSession.tenantId === 'string' && hostSession.tenantId !== ''
    ? hostSession.tenantId
    : 'mobile'
  const expiresAt = typeof hostSession.expiresAt === 'number' && hostSession.expiresAt > Date.now()
    ? hostSession.expiresAt
    : Date.now() + 8 * 3600_000
  const modules = Array.isArray(hostSession.modules)
    ? hostSession.modules.filter((item) => item && typeof item.id === 'string' && item.id !== '')
    : []
  const publicSession = {
    username: hostSession.username,
    displayName: hostSession.displayName,
    enterpriseName: hostSession.enterpriseName,
    tenantId,
    systemName: hostSession.systemName,
    logo: hostSession.logo,
    roles: hostSession.roles,
    moduleId: hostSession.moduleId,
    moduleName: hostSession.moduleName,
    moduleLogo: hostSession.moduleLogo,
    modules,
    expiresAt,
    needsModulePick: false,
    // Placeholder so phone usableHostSession / identity UI treat the stash as signed-in.
    // Real PC token stays on the Host; phone does not call enterprise APIs with this value.
    accessToken: 'mobile-cowatch',
  }
  // Only forward a still-valid key expiry. An expired llmApiKeyExpiresAt makes
  // t4y-identity readSession() wipe the whole session and re-show the login gate.
  if (typeof hostSession.llmApiKeyExpiresAt === 'number' && hostSession.llmApiKeyExpiresAt > Date.now()) {
    publicSession.llmApiKeyExpiresAt = hostSession.llmApiKeyExpiresAt
  } else if (modelKeyPresent) {
    publicSession.llmApiKeyExpiresAt = Date.now() + 8 * 3600_000
  }
  return { session: publicSession, modelKeyPresent }
}

/**
 * @param {string | null} requestOrigin
 * @returns {string | null}
 */
function originFromRequest(request) {
  try {
    const forwarded = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    if (typeof forwarded === 'string' && forwarded !== '') {
      return `${proto}://${forwarded.split(',')[0].trim()}`.replace(/\/$/u, '')
    }
  } catch {
    // optional
  }
  return null
}

/**
 * Step 1: authenticate only; return host list for this account (self if logged-in match).
 * @param {import('cordis').Context} ctx
 * @param {Request} request
 * @param {{ isAccepting: () => boolean }} options
 * @returns {Promise<Response>}
 */
export async function handleEnterLogin(ctx, request, _accessControllers, options = {}) {
  const isAccepting = typeof options.isAccepting === 'function' ? options.isAccepting : () => true
  if (!isAccepting()) {
    return enterJson(503, { error: 'remote_off' })
  }
  const peer = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'local'
  if (!takeLoginSlot(peer)) {
    return enterJson(429, { error: 'rate_limited' })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return enterJson(400, { error: 'invalid_request' })
  }

  const enterpriseName = typeof body?.enterpriseName === 'string' ? body.enterpriseName.trim() : ''
  const userName = typeof body?.userName === 'string' ? body.userName.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (enterpriseName === '' || userName === '' || password === '') {
    return enterJson(400, { error: 'invalid_request' })
  }

  let keyPayload
  try {
    keyPayload = await callEnterpriseApi(ctx, '/auth/publicKey', 'GET')
  } catch {
    return enterJson(502, { error: 'pair_failed', message: 'enterprise_unavailable' })
  }
  if (keyPayload.json?.code !== 200 || typeof keyPayload.json?.data?.publicKey !== 'string') {
    return enterJson(502, { error: 'pair_failed', message: 'public_key_unavailable' })
  }

  let encrypted
  try {
    encrypted = encryptPassword(keyPayload.json.data.publicKey, password)
  } catch {
    return enterJson(400, { error: 'auth_failed' })
  }

  let loginPayload
  try {
    loginPayload = await callEnterpriseApi(
      ctx,
      '/auth/login',
      'POST',
      JSON.stringify({ enterpriseName, userName, password: encrypted }),
    )
  } catch {
    return enterJson(502, { error: 'pair_failed', message: 'enterprise_unavailable' })
  }
  if (loginPayload.json?.code !== 200 || typeof loginPayload.json?.data?.access_token !== 'string') {
    return enterJson(401, { error: 'auth_failed' })
  }

  const accessToken = loginPayload.json.data.access_token
  const expiresInMin = Number(loginPayload.json.data.expires_in)
  const expiresAt = Date.now() + (Number.isFinite(expiresInMin) && expiresInMin > 0
    ? expiresInMin * 60_000
    : 8 * 3600_000)
  const accountKey = accountKeyOf(enterpriseName, userName)
  const hosts = []
  const self = await buildSelfHostCard(isAccepting(), originFromRequest(request))
  if (self && self.accountKey === accountKey) {
    hosts.push(self)
  }

  return enterJson(200, {
    ok: true,
    phase: 'select',
    accessToken,
    expiresAt,
    accountKey,
    enterpriseName,
    userName,
    hosts,
  })
}

/**
 * Step 2: redeem enterprise token on the chosen PC and open pairing.
 * @param {import('cordis').Context} ctx
 * @param {Request} request
 * @param {Set<object>} accessControllers
 * @param {{ isAccepting: () => boolean }} options
 * @returns {Promise<Response>}
 */
export async function handleEnterSelect(ctx, request, accessControllers, options = {}) {
  const isAccepting = typeof options.isAccepting === 'function' ? options.isAccepting : () => true
  if (!isAccepting()) {
    return enterJson(503, { error: 'remote_off' })
  }

  const peer = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'local'
  if (!takeLoginSlot(`select:${peer}`)) {
    return enterJson(429, { error: 'rate_limited' })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return enterJson(400, { error: 'invalid_request' })
  }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
  const enterpriseName = typeof body?.enterpriseName === 'string' ? body.enterpriseName.trim() : ''
  const userName = typeof body?.userName === 'string' ? body.userName.trim() : ''
  if (accessToken === '' || enterpriseName === '' || userName === '') {
    return enterJson(400, { error: 'invalid_request' })
  }

  let info
  try {
    info = await callEnterpriseApi(ctx, '/system/user/getInfo', 'GET', undefined, {
      Authorization: accessToken,
    })
  } catch {
    return enterJson(401, { error: 'auth_failed' })
  }
  if (!info.ok || info.json?.code !== 200) {
    return enterJson(401, { error: 'auth_failed' })
  }
  const apiUser = String(info.json?.data?.user?.userName || '').trim().toLowerCase()
  const apiEnt = String(info.json?.data?.enterprise?.name || '').trim()
  if (apiUser === '' || apiUser !== userName.trim().toLowerCase()) {
    return enterJson(401, { error: 'auth_failed' })
  }
  if (enterpriseName !== '' && apiEnt !== '' && enterpriseName !== apiEnt) {
    return enterJson(401, { error: 'auth_failed' })
  }

  const hostSession = await readHostSession()
  if (!hostSession || !sameAccount(hostSession, userName, enterpriseName)) {
    return enterJson(409, { error: 'host_not_ready' })
  }

  if (accessControllers.size === 0) {
    return enterJson(503, { error: 'remote_off' })
  }
  const pairing = await openPairingToken(accessControllers)
  if (pairing === null) {
    return enterJson(503, { error: 'remote_off' })
  }

  const hostReady = await buildPublicHostReady(hostSession, ctx)
  return enterJson(200, {
    ok: true,
    redirect: '/',
    pairToken: pairing.token,
    hostReady,
  })
}

/**
 * Public card for phone probes (remembered origins).
 * @param {boolean} accepting
 * @param {string | null} requestOrigin
 * @returns {Promise<Response>}
 */
export async function handleHostCard(accepting, requestOrigin) {
  const card = await buildSelfHostCard(accepting, requestOrigin)
  if (!card) return enterJson(404, { error: 'host_not_ready' })
  return enterJson(200, card)
}

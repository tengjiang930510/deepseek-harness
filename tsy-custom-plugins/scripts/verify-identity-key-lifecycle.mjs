#!/usr/bin/env node
/**
 * Rigorous acceptance for t4y-identity Key lifecycle against a running DSH Web.
 *
 * Checks:
 * 1) Overlay has no hardcoded model catalog (models: [])
 * 2) Login → issue → models come from New API with display names + default flash
 * 3) session-status active while Key lives
 * 4) revoke → Key rejected by New API + status inactive
 * 5) Re-issue after revoke works again
 *
 * Usage:
 *   DSH_WEB_TOKEN=<boot-token> \\
 *   ENTERPRISE_NAME=... ENTERPRISE_USER=... ENTERPRISE_PASSWORD=... \\
 *   node tsy-custom-plugins/scripts/verify-identity-key-lifecycle.mjs
 *
 * Optional env:
 *   DSH_WEB_BASE=http://127.0.0.1:3080
 *   ENTERPRISE_API_BASE / NEW_API_BASE
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const overlayPath = join(root, 'tenant-identity.overlay.yml')
const webBase = (process.env.DSH_WEB_BASE || 'http://127.0.0.1:3080').replace(/\/$/, '')
const bootToken = process.env.DSH_WEB_TOKEN || ''
const enterpriseName = process.env.ENTERPRISE_NAME || ''
const enterpriseUser = process.env.ENTERPRISE_USER || ''
const enterprisePassword = process.env.ENTERPRISE_PASSWORD || ''
const apiBase = process.env.ENTERPRISE_API_BASE || 'https://jgyw.crfsdi.com.cn:51111/backendapi'
const newApiBase = process.env.NEW_API_BASE || 'http://192.10.51.138:4000/v1'

const failures = []
const pass = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
const fail = (name, detail) => {
  failures.push(`${name}: ${detail}`)
  console.error(`FAIL  ${name} — ${detail}`)
}

function assert(name, condition, detail) {
  if (condition) pass(name, detail)
  else fail(name, detail)
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  return { status: response.status, ok: response.ok, body, headers: response.headers }
}

function bytesToBigInt(bytes) {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return BigInt(`0x${hex || '0'}`)
}

function bigIntToBytes(value, length) {
  let hex = value.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const raw = new Uint8Array(hex.length / 2)
  for (let i = 0; i < raw.length; i += 1) raw[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  if (raw.length === length) return raw
  if (raw.length > length) return raw.slice(raw.length - length)
  const out = new Uint8Array(length)
  out.set(raw, length - raw.length)
  return out
}

function modPow(base, exp, mod) {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

function readDerLength(bytes, offset) {
  const first = bytes[offset]
  if (first < 0x80) return { length: first, offset: offset + 1 }
  const size = first & 0x7f
  let length = 0
  for (let i = 0; i < size; i += 1) length = (length << 8) | bytes[offset + 1 + i]
  return { length, offset: offset + 1 + size }
}

function readDerInteger(bytes, offset) {
  if (bytes[offset] !== 0x02) throw new Error('Expected INTEGER')
  const { length, offset: next } = readDerLength(bytes, offset + 1)
  return { value: bytesToBigInt(bytes.slice(next, next + length)), offset: next + length }
}

function parseSpkiPublicKey(spkiBase64) {
  const bytes = Uint8Array.from(Buffer.from(spkiBase64, 'base64'))
  let offset = 0
  if (bytes[offset++] !== 0x30) throw new Error('Expected SEQUENCE')
  ;({ offset } = readDerLength(bytes, offset))
  if (bytes[offset++] !== 0x30) throw new Error('Expected AlgorithmIdentifier')
  ;({ offset } = readDerLength(bytes, offset))
  offset += 2 + bytes[offset + 1] // OID
  if (bytes[offset] === 0x05) offset += 2 // NULL
  if (bytes[offset++] !== 0x03) throw new Error('Expected BIT STRING')
  ;({ offset } = readDerLength(bytes, offset))
  offset += 1 // unused bits
  if (bytes[offset++] !== 0x30) throw new Error('Expected RSAPublicKey SEQUENCE')
  ;({ offset } = readDerLength(bytes, offset))
  const modulus = readDerInteger(bytes, offset)
  const exponent = readDerInteger(bytes, modulus.offset)
  return { n: modulus.value, e: exponent.value }
}

function rsaEncryptPkcs1(publicKey, plaintext) {
  const message = new TextEncoder().encode(plaintext)
  const k = Math.ceil(publicKey.n.toString(16).length / 2)
  if (message.length > k - 11) throw new Error('message too long for RSA key')
  const psLen = k - message.length - 3
  const ps = new Uint8Array(psLen)
  for (let i = 0; i < psLen; i += 1) {
    let byte = 0
    while (byte === 0) byte = crypto.getRandomValues(new Uint8Array(1))[0]
    ps[i] = byte
  }
  const em = new Uint8Array(k)
  em[0] = 0x00
  em[1] = 0x02
  em.set(ps, 2)
  em[2 + psLen] = 0x00
  em.set(message, 3 + psLen)
  const cipher = modPow(bytesToBigInt(em), publicKey.e, publicKey.n)
  return Buffer.from(bigIntToBytes(cipher, k)).toString('base64')
}

async function enterpriseLogin() {
  const pk = await jsonFetch(`${apiBase}/auth/publicKey`)
  if (!pk.ok || typeof pk.body?.data?.publicKey !== 'string') throw new Error(`publicKey failed: ${pk.status}`)
  const encrypted = rsaEncryptPkcs1(parseSpkiPublicKey(pk.body.data.publicKey), enterprisePassword)
  const login = await jsonFetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enterpriseName, userName: enterpriseUser, password: encrypted }),
  })
  if (!login.ok || typeof login.body?.data?.access_token !== 'string') {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`)
  }
  // Enterprise login `expires_in` is minutes; Broker expects seconds (cap 30 days).
  const minutes = Number(login.body.data.expires_in)
  const maxSeconds = 30 * 24 * 60 * 60
  const expiresIn = Number.isFinite(minutes) && minutes > 0
    ? Math.min(Math.floor(minutes * 60), maxSeconds)
    : maxSeconds
  return {
    accessToken: login.body.data.access_token,
    expiresIn,
  }
}

async function main() {
  console.log('=== Overlay static checks ===')
  const overlay = readFileSync(overlayPath, 'utf8')
  assert('overlay-no-hardcoded-flash-model-entry', !/^\s*- id:\s*qwen3\.8-flash\s*$/m.test(overlay), 'no seed model id rows')
  assert('overlay-no-hardcoded-max-model-entry', !/^\s*- id:\s*qwen3\.8-max\s*$/m.test(overlay), 'no seed model id rows')
  // CLI overlay on llm-pi-ai locks settings.update and blocks New API catalog sync.
  assert('overlay-does-not-patch-llm-pi-ai', !/^\s*- id:\s*llm-pi-ai\s*$/m.test(overlay), 'llm-pi-ai must be seeded in writable settings')
  assert('overlay-does-not-patch-agent-default-model', !/^\s*- id:\s*agent-default-model\s*$/m.test(overlay), 'default model set after sync')
  assert('overlay-keeps-identity-newapi-url', /newApiBaseUrl:\s*http:\/\/192\.10\.51\.138:4000\/v1/.test(overlay), 'identity points at New API')

  if (!bootToken) {
    fail('boot-token', 'set DSH_WEB_TOKEN from `dsh web` output')
    process.exit(1)
  }
  if (!enterpriseName || !enterpriseUser || !enterprisePassword) {
    fail('enterprise-credentials', 'set ENTERPRISE_NAME, ENTERPRISE_USER, and ENTERPRISE_PASSWORD')
    process.exit(1)
  }

  console.log('=== DSH session bootstrap ===')
  const jar = new Map()
  const boot = await fetch(`${webBase}/?token=${encodeURIComponent(bootToken)}`, { redirect: 'manual' })
  const setCookie = boot.headers.getSetCookie?.() || []
  for (const raw of setCookie) {
    const [pair] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  assert('dsh-boot-cookie', cookieHeader.length > 0, `status=${boot.status}`)

  const dsh = async (path, options = {}) => jsonFetch(`${webBase}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      cookie: cookieHeader,
    },
  })

  console.log('=== Enterprise login + issue ===')
  const session = await enterpriseLogin()
  const issue = await dsh('/api/t4y-identity/issue-model-key', {
    method: 'POST',
    headers: {
      authorization: session.accessToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: session.expiresIn }),
  })
  assert('issue-http-200', issue.status === 200, `status=${issue.status} body=${JSON.stringify(issue.body).slice(0, 240)}`)
  assert('issue-returns-expiresAt', typeof issue.body?.expiresAt === 'number', String(issue.body?.expiresAt))
  assert('issue-returns-models-from-newapi', Array.isArray(issue.body?.models) && issue.body.models.length >= 2, JSON.stringify(issue.body?.models))
  assert(
    'issue-model-display-names',
    issue.body?.models?.some(m => m.id === 'qwen3.8-flash' && m.name === 'Qwen 3.8 Flash')
      && issue.body?.models?.some(m => m.id === 'qwen3.8-max' && m.name === 'Qwen 3.8 Max'),
    JSON.stringify(issue.body?.models),
  )
  assert('issue-default-prefers-flash', issue.body?.defaultModel === 'qwen3.8-flash', String(issue.body?.defaultModel))
  assert('issue-does-not-return-apiKey', issue.body?.apiKey === undefined, 'apiKey must stay host-only')

  // Recover Key via Broker re-issue fingerprint (same login token) by asking New API through a
  // second broker issue is not possible without reading credentials. Use status + revoke instead,
  // and recover Key by calling Broker issue directly once for chat verification only in this script.
  const brokerIssue = await jsonFetch('http://192.10.51.138:4010/v1/session/issue', {
    method: 'POST',
    headers: { authorization: session.accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: session.expiresIn }),
  })
  assert('broker-reissue-same-session', brokerIssue.status === 200 && typeof brokerIssue.body?.apiKey === 'string', JSON.stringify(brokerIssue.body).slice(0, 200))
  const apiKey = brokerIssue.body.apiKey
  assert('broker-reissue-same-expiry', brokerIssue.body.expiresAt === issue.body.expiresAt, `${brokerIssue.body.expiresAt} vs ${issue.body.expiresAt}`)

  const modelsDirect = await jsonFetch(`${newApiBase}/models`, { headers: { authorization: `Bearer ${apiKey}` } })
  assert('newapi-models-match-issue', modelsDirect.ok && JSON.stringify((modelsDirect.body?.data || []).map(m => m.id).sort())
    === JSON.stringify([...issue.body.models.map(m => m.id)].sort()), JSON.stringify(modelsDirect.body))

  console.log('=== session-status while active ===')
  const statusActive = await dsh('/api/t4y-identity/session-status', {
    method: 'POST',
    headers: { authorization: session.accessToken },
  })
  assert('status-active-true', statusActive.status === 200 && statusActive.body?.active === true, JSON.stringify(statusActive.body))

  console.log('=== chat works before revoke ===')
  const chatBefore = await jsonFetch(`${newApiBase}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.8-flash', messages: [{ role: 'user', content: '只回复：P0OK' }], max_tokens: 16 }),
  })
  assert('chat-before-revoke-200', chatBefore.status === 200 && Array.isArray(chatBefore.body?.choices), `status=${chatBefore.status}`)

  console.log('=== revoke ===')
  const revoke = await dsh('/api/t4y-identity/revoke-model-key', {
    method: 'POST',
    headers: { authorization: session.accessToken },
  })
  assert('revoke-http-200', revoke.status === 200 && revoke.body?.revoked === true, JSON.stringify(revoke.body))

  const statusAfter = await dsh('/api/t4y-identity/session-status', {
    method: 'POST',
    headers: { authorization: session.accessToken },
  })
  assert('status-after-revoke-inactive', statusAfter.status === 200 && statusAfter.body?.active === false, JSON.stringify(statusAfter.body))

  const chatAfter = await jsonFetch(`${newApiBase}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.8-flash', messages: [{ role: 'user', content: 'should fail' }], max_tokens: 8 }),
  })
  assert('chat-after-revoke-rejected', chatAfter.status === 401 || chatAfter.status === 403 || chatAfter.body?.error, `status=${chatAfter.status} body=${JSON.stringify(chatAfter.body).slice(0, 180)}`)

  console.log('=== re-issue after revoke ===')
  const reissue = await dsh('/api/t4y-identity/issue-model-key', {
    method: 'POST',
    headers: {
      authorization: session.accessToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: session.expiresIn }),
  })
  assert('reissue-http-200', reissue.status === 200 && Array.isArray(reissue.body?.models), JSON.stringify(reissue.body).slice(0, 240))
  assert('reissue-models-still-from-newapi', reissue.body?.models?.length >= 2, JSON.stringify(reissue.body?.models))

  const statusReissued = await dsh('/api/t4y-identity/session-status', {
    method: 'POST',
    headers: { authorization: session.accessToken },
  })
  assert('status-after-reissue-active', statusReissued.status === 200 && statusReissued.body?.active === true, JSON.stringify(statusReissued.body))

  // Cleanup: revoke again so the acceptance key does not linger.
  await dsh('/api/t4y-identity/revoke-model-key', {
    method: 'POST',
    headers: { authorization: session.accessToken },
  })

  console.log('\n=== Summary ===')
  if (failures.length === 0) {
    console.log('ALL CHECKS PASSED')
    process.exit(0)
  }
  console.error(`${failures.length} CHECK(S) FAILED`)
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

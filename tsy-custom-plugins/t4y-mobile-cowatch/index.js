/**
 * Host half for mobile co-watch: expose whether the PC already holds the model key,
 * and bind dsh-mobile device labels to the enterprise displayName (Codex-style).
 */
import { readFileSync } from 'node:fs'
import { readFile, writeFile, rename as renameFile, mkdir, access } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { enterpriseEnterPage, enterpriseOfflinePage } from './enter-page.js'
import {
  handleEnterLogin,
  handleEnterSelect,
  handleHostCard,
  buildPublicHostReady,
  accountKeyOf,
} from './enter-login.js'
import {
  mintHandoffTicket,
  redeemHandoffTicket,
  sanitizeHandoffPayload,
} from './handoff.js'

export const name = 't4y-mobile-cowatch'
export const inject = {
  connection: true,
  credentials: true,
  webServer: { required: false },
}

const MODEL_CREDENTIAL_REF = 'T4Y_NEW_API_KEY'
const GENERIC_LABELS = new Set(['Mobile device', 'DeepSeek Harness Android', '1', 'test1'])

/** @type {Set<object>} */
const accessControllers = new Set()

/** @type {Set<object>} */
const mobileGateways = new Set()

/**
 * In-process enter login (same Node as Gateway). Avoids Host Web cookie auth on /api/*.
 * @type {null | ((request: Request) => Promise<Response>)}
 */
let enterLoginHandler = null
/** @type {null | ((request: Request) => Promise<Response>)} */
let enterSelectHandler = null

/**
 * Soft-off: FRP stays up so the public URL can show an offline page;
 * phone enter/pair is refused until accepting === true.
 * Fail closed until apply() loads the durable flag (avoids a short open window).
 * @type {boolean}
 */
let acceptingEngagements = false

/** Raise above stock 64 so one FRP phone + asset burst cannot trip the hard reject. */
const GATEWAY_MAX_CONNECTIONS = 256
/** Stock dsh-mobile hardcodes 5s; longer reuse cuts TIME_WAIT churn through FRP. */
const GATEWAY_KEEP_ALIVE_MS = 65_000

/**
 * Apply connection-budget tuning on a live MobileAccessGateway (safe to call repeatedly).
 * @param {object} gateway
 */
function tuneGatewayInstance(gateway) {
  if (!gateway || typeof gateway !== 'object') return
  mobileGateways.add(gateway)
  try {
    const config = gateway.config
    if (config && typeof config === 'object') {
      const current = Number(config.maxConnections)
      if (!Number.isFinite(current) || current < GATEWAY_MAX_CONNECTIONS) {
        config.maxConnections = GATEWAY_MAX_CONNECTIONS
      }
    }
  } catch {
    // config may be non-extensible
  }
  const server = gateway.server
  if (!server || typeof server !== 'object') return
  try {
    server.maxConnections = Math.max(Number(server.maxConnections) || 0, GATEWAY_MAX_CONNECTIONS)
    server.keepAliveTimeout = GATEWAY_KEEP_ALIVE_MS
    // Node requires headersTimeout > keepAliveTimeout when keep-alive is used.
    const headersTimeout = Number(server.headersTimeout) || 0
    if (headersTimeout <= GATEWAY_KEEP_ALIVE_MS) {
      server.headersTimeout = GATEWAY_KEEP_ALIVE_MS + 1_000
    }
  } catch {
    // ignore per-server apply failures
  }
}

/**
 * Best-effort: retune gateways already listening before this plugin loaded.
 * Fingerprint stock dsh-mobile (maxConnections === 64, keepAliveTimeout === 5s).
 * A loopback probe forces handleExternalRequest so config.maxConnections is raised too
 * (the connection reject reads config, not only server.maxConnections).
 */
function tuneLiveGatewayServers() {
  for (const gateway of [...mobileGateways]) tuneGatewayInstance(gateway)
  try {
    const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : []
    for (const handle of handles) {
      if (!handle || typeof handle !== 'object') continue
      // dsh-mobile sets maxConnections from config (default 64); Host web uses Infinity.
      if (handle.maxConnections !== 64) continue
      try {
        handle.maxConnections = GATEWAY_MAX_CONNECTIONS
        handle.keepAliveTimeout = GATEWAY_KEEP_ALIVE_MS
        const headersTimeout = Number(handle.headersTimeout) || 0
        if (headersTimeout <= GATEWAY_KEEP_ALIVE_MS) {
          handle.headersTimeout = GATEWAY_KEEP_ALIVE_MS + 1_000
        }
      } catch {
        // skip foreign / closed handles
      }
    }
  } catch {
    // _getActiveHandles is undocumented; never block boot
  }
  if (mobileGateways.size === 0) {
    void fetch('http://127.0.0.1:3443/', {
      method: 'GET',
      signal: AbortSignal.timeout(1_500),
    }).catch(() => {
      // gateway may be down or TLS-only in other profiles
    })
  }
}

/**
 * @returns {string}
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  return join(homedir(), '.dsh')
}

/**
 * @returns {string}
 */
function devicesPath() {
  return join(dshHome(), 'mobile-access', 'remote', 'devices.json')
}

/**
 * @returns {string}
 */
function acceptingPath() {
  return join(dshHome(), 'mobile-access', 't4y-accepting.json')
}

/**
 * @returns {boolean}
 */
function isAccepting() {
  return acceptingEngagements === true
}

/**
 * Synchronous boot load so public intercepts never race an open default.
 * Missing file → first install defaults to accepting.
 * @returns {boolean}
 */
function loadAcceptingSync() {
  try {
    const parsed = JSON.parse(readFileSync(acceptingPath(), 'utf8'))
    acceptingEngagements = parsed?.accepting !== false
  } catch {
    acceptingEngagements = true
  }
  return acceptingEngagements
}

/**
 * @returns {Promise<boolean>}
 */
async function loadAccepting() {
  return loadAcceptingSync()
}

/**
 * @returns {boolean}
 */
function isAnyPairingOpen() {
  for (const controller of [...accessControllers]) {
    try {
      if (typeof controller.pairingStatus === 'function' && controller.pairingStatus()?.open === true) {
        return true
      }
    } catch {
      // try next
    }
  }
  return false
}

/**
 * Loopback base for Host-only follow-up calls (set-context / workspace / apply-module).
 * @param {import('cordis').Context} ctx
 * @returns {string}
 */
function hostLoopbackBase(ctx) {
  let port = 3080
  try {
    const webServer = ctx.get('webServer')
    if (webServer && typeof webServer.port === 'number' && webServer.port > 0) {
      port = webServer.port
    }
  } catch {
    // keep default
  }
  return `http://127.0.0.1:${port}`
}

/**
 * Persist soft-off / soft-on. When turning off, revoke paired phones so live sessions drop.
 * @param {boolean} accepting
 * @returns {Promise<{ accepting: boolean, revoked: number }>}
 */
async function setAccepting(accepting) {
  acceptingEngagements = accepting === true
  const file = acceptingPath()
  await mkdir(dirname(file), { recursive: true })
  const body = `${JSON.stringify({ accepting: acceptingEngagements, updatedAt: Date.now() })}\n`
  const temporary = join(dirname(file), `.t4y-accepting.${randomBytes(8).toString('hex')}.tmp`)
  await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await renameFile(temporary, file)
  let revoked = 0
  if (!acceptingEngagements) {
    revoked = await revokeAllMobileDevices()
  }
  return { accepting: acceptingEngagements, revoked }
}

/**
 * Kick every paired mobile device when the PC soft-closes mobile access.
 * @returns {Promise<number>}
 */
async function revokeAllMobileDevices() {
  let count = 0
  for (const controller of [...accessControllers]) {
    try {
      if (typeof controller.resetDevices === 'function') {
        const before = typeof controller.listDevices === 'function' ? controller.listDevices().length : 0
        await controller.resetDevices()
        count += before
        continue
      }
      if (typeof controller.listDevices !== 'function' || typeof controller.revokeDevice !== 'function') continue
      const devices = controller.listDevices()
      for (const device of devices) {
        if (!device || typeof device.id !== 'string') continue
        try {
          if (await controller.revokeDevice(device.id)) count += 1
        } catch {
          // continue other devices
        }
      }
    } catch {
      // try next controller
    }
  }
  return count
}

/**
 * @returns {string}
 */
function enterHtmlForAccepting() {
  return isAccepting() ? enterpriseEnterPage() : enterpriseOfflinePage()
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} html
 */
function writeHtml(response, html) {
  const buffer = Buffer.from(html, 'utf8')
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  })
  response.end(buffer)
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 */
/**
 * @param {import('node:http').IncomingMessage | undefined} request
 * @returns {Record<string, string>}
 */
/**
 * host-card / enter CORS for cross-origin probes (no credentials).
 * Fixed `*` — do not reflect arbitrary Origin.
 * @returns {Record<string, string>}
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 * @param {import('node:http').IncomingMessage} [request]
 * @param {boolean} [withCors]
 */
function writeJson(response, status, value, _request, withCors = false) {
  const buffer = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...(withCors ? corsHeaders() : {}),
  })
  response.end(buffer)
}

/**
 * Shared public HTTP routes for FRP → Gateway or Host :3080.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ pairingOpen?: boolean | null }} [options]
 *   `pairingOpen: true|false` from Gateway; omit/`null` → any tracked AccessController.
 * @returns {boolean} true when this plugin fully handled the request
 */
function tryHandlePublicMobileHttp(req, res, options = {}) {
  const pathname = String(req?.url || '').split('?')[0] || '/'
  const method = req?.method
  if (method === 'GET' && pathname === '/t4y-mobile-enter') {
    writeHtml(res, enterHtmlForAccepting())
    return true
  }
  if (
    method === 'OPTIONS'
    && (pathname.startsWith('/api/t4y-mobile-enter/')
      || pathname === '/api/t4y-mobile-cowatch/handoff-mint'
      || pathname === '/api/t4y-mobile-cowatch/handoff-redeem')
  ) {
    res.writeHead(204, corsHeaders())
    res.end()
    return true
  }
  if (method === 'GET' && pathname === '/api/t4y-mobile-enter/status') {
    writeJson(res, 200, { accepting: isAccepting() }, req, true)
    return true
  }
  if (method === 'GET' && pathname === '/api/t4y-mobile-enter/host-card') {
    const origin = typeof req.headers['x-forwarded-proto'] === 'string'
      && typeof req.headers.host === 'string'
      ? `${req.headers['x-forwarded-proto']}://${String(req.headers.host).split(',')[0].trim()}`
      : (typeof req.headers.host === 'string' ? `https://${req.headers.host}` : null)
    void handleHostCard(isAccepting(), origin).then(async (result) => {
      const text = await result.text()
      const buffer = Buffer.from(text, 'utf8')
      res.writeHead(result.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      })
      res.end(buffer)
    })
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-enter/login') {
    void respondEnterApi(req, res, 'login')
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-enter/select') {
    void respondEnterApi(req, res, 'select')
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-cowatch/handoff-mint') {
    void respondHandoffMint(req, res)
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-cowatch/handoff-redeem') {
    void respondHandoffRedeem(req, res)
    return true
  }
  if (method === 'GET' && (pathname === '/mobile-access/pair' || pathname === '/mobile-access/pair.js')) {
    if (!isAccepting()) {
      writeHtml(res, enterpriseOfflinePage())
      return true
    }
    // Gateway passes explicit true/false. Host :3080 Server emit passes null:
    // - no tracked controllers yet → still serve (FRP often hits Host, not Gateway)
    // - controllers tracked → require an open pairing window
    // - closed window on Host → friendly page (Host has no stock /pair → would 404)
    let pairingOpen = options.pairingOpen
    if (pairingOpen !== true && pairingOpen !== false) {
      pairingOpen = accessControllers.size === 0 ? true : isAnyPairingOpen()
    }
    if (pairingOpen !== true) {
      if (options.pairingOpen === false) {
        // Gateway: defer to stock dsh-mobile pair UI / expiry handling.
        return false
      }
      writeHtml(res, enterprisePairClosedPage())
      return true
    }
    const body = pathname.endsWith('.js') ? enterprisePairScript() : enterprisePairPage()
    const contentType = pathname.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : 'text/html; charset=utf-8'
    const buffer = Buffer.from(body, 'utf8')
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
      Vary: 'Accept-Language, Cookie',
    })
    res.end(buffer)
    return true
  }
  return false
}

/**
 * Host-side pair when the QR window is closed (no stock /mobile-access/pair on :3080).
 * @returns {string}
 */
function enterprisePairClosedPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>请刷新二维码</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#f3f4f6;color:#111827}
.card{max-width:22rem;padding:1.5rem;border-radius:1rem;background:#fff;
box-shadow:0 8px 24px rgba(15,23,42,.08);text-align:center}
h1{font-size:1.1rem;margin:0 0 .5rem}
p{margin:0;color:#6b7280;font-size:.9rem;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <h1>配对已过期</h1>
  <p>请在电脑端账号菜单打开「移动访问」，刷新二维码后再扫。</p>
</div>
</body>
</html>`
}

/**
 * @param {number} status
 * @param {unknown} value
 */
function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * @returns {Promise<string | null>}
 */
async function readHostDisplayName() {
  try {
    const raw = await readFile(join(dshHome(), 't4y-identity', 'host-session.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const nested = parsed?.session
    const candidates = [
      typeof parsed?.displayName === 'string' ? parsed.displayName : '',
      typeof nested?.displayName === 'string' ? nested.displayName : '',
      typeof nested?.name === 'string' ? nested.name : '',
    ]
    for (const candidate of candidates) {
      const name = candidate.trim()
      if (name !== '') return name.slice(0, 64)
    }
    return null
  } catch {
    return null
  }
}

/**
 * @param {string} label
 * @returns {string}
 */
function normalizeEnterpriseLabel(label) {
  const next = label.normalize('NFC').trim().slice(0, 64)
  if (next === '' || /[\u0000-\u001f\u007f]/u.test(next)) {
    throw new Error('invalid_label')
  }
  return next
}

/**
 * @param {Request} request
 * @returns {string | null}
 */
function deviceIdFromRequest(request) {
  const cookie = request.headers.get('cookie') || ''
  const host = cookie.match(/(?:^|;\s*)__Host-dsh_ma_device_id=([^;]+)/)
  if (host?.[1]) {
    try {
      return decodeURIComponent(host[1].trim())
    } catch {
      return host[1].trim()
    }
  }
  return null
}

/**
 * Enterprise browser pair page: QR-only auto bind. Minimal copy; script inlined to save a round trip.
 * @returns {string}
 */
function enterprisePairPage() {
  return `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>连接本机助手</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827}
  main{width:min(22rem,92vw);padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  h1{font-size:1.15rem;margin:0 0 .75rem}
  p{margin:0;line-height:1.5;color:#4b5563;font-size:.95rem}
</style>
<main>
  <h1>连接本机助手</h1>
  <p id="status" aria-live="polite">正在连接…</p>
</main>
<script>${enterprisePairScript()}<\/script>
</html>`
}

/**
 * Auto-submit pairing from the QR hash only; never show a fill-in form.
 * @returns {string}
 */
function enterprisePairScript() {
  return `(() => {
  const status = document.getElementById('status')
  let submitting = false
  const fragment = new URLSearchParams(location.hash.slice(1))
  let supplied = fragment.get('token')
  const key = fragment.get('key')
  if (!supplied && typeof key === 'string') {
    const parts = key.split('.')
    if (parts.length >= 3 && /^dsh[12]$/u.test(parts[0])) supplied = parts.slice(2).join('.')
  }
  history.replaceState(null, '', location.pathname)
  function fail(message) {
    status.textContent = message
  }
  function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  }
  async function pair(code) {
    if (submitting) return
    submitting = true
    status.textContent = '正在连接…'
    try {
      const response = await fetch('/mobile-access/auth/pair', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        // Always send a non-empty label so flaky empty-body/omit-label 400s cannot block scan-in;
        // Host AccessController hook rewrites it to enterprise displayName when available.
        body: JSON.stringify({ token: code, label: '手机' }),
      })
      if (!response.ok) {
        fail(response.status === 401 || response.status === 403 ? '配对已过期，请在电脑端刷新二维码后重试'
          : response.status === 429 ? '尝试过多，请稍后再试'
          : response.status === 409 ? '设备数量已满，请在电脑端清理后再试'
          : '连接失败，请重新扫码')
        return
      }
      status.textContent = '正在进入…'
      // Prefetch public hostReady + Host-only switchAuth seed (never from host-session GET).
      try {
        sessionStorage.setItem('t4y.mobile.cowatch', '1')
        sessionStorage.setItem('t4y.mobile.cowatch.entered.v1', '1')
        let hostLabel = location.host
        let seededAccountKey = ''
        const ready = await fetch('/api/t4y-identity/host-session', {
          method: 'GET',
          credentials: 'same-origin',
          signal: timeoutSignal(4000),
        })
        if (ready.ok) {
          const body = await ready.json()
          const session = body?.session && typeof body.session === 'object' ? { ...body.session } : null
          const modelKeyPresent = body?.modelKeyPresent === true
          if (session) {
            session.accessToken = 'mobile-cowatch'
            session.needsModulePick = false
            if (typeof session.tenantId !== 'string' || session.tenantId === '') session.tenantId = 'mobile'
            const expiresAt = typeof session.expiresAt === 'number' && session.expiresAt > Date.now()
              ? session.expiresAt
              : Date.now() + 8 * 3600_000
            session.expiresAt = expiresAt
            if (modelKeyPresent && (typeof session.llmApiKeyExpiresAt !== 'number' || session.llmApiKeyExpiresAt <= Date.now())) {
              session.llmApiKeyExpiresAt = Date.now() + 8 * 3600_000
            }
            if (!modelKeyPresent) delete session.llmApiKeyExpiresAt
            if (typeof session.displayName === 'string' && session.displayName !== '') {
              hostLabel = session.displayName
            }
            localStorage.setItem('t4y.identity.session.v1', JSON.stringify(session))
            localStorage.setItem('t4y.identity.fresh-auth.v1', String(Date.now() + 120_000))
          }
          sessionStorage.setItem('t4y.mobile.hostReady.v1', JSON.stringify({
            at: Date.now(),
            session,
            modelKeyPresent,
          }))
        }
        try {
          const seed = await fetch('/api/t4y-mobile-cowatch/switch-auth-seed', {
            method: 'GET',
            credentials: 'same-origin',
            signal: timeoutSignal(4000),
          })
          if (seed.ok) {
            const seeded = await seed.json()
            if (seeded?.switchAuth && typeof seeded.switchAuth.accessToken === 'string') {
              sessionStorage.setItem('t4y.mobile.switchAuth.v1', JSON.stringify(seeded.switchAuth))
              try { localStorage.removeItem('t4y.mobile.switchAuth.v1') } catch { /* ignore */ }
              if (typeof seeded.switchAuth.accountKey === 'string') {
                seededAccountKey = seeded.switchAuth.accountKey
              }
            }
          }
        } catch { /* optional for current-PC scan */ }
        try {
          localStorage.setItem('t4y.mobile.currentHost.v1', JSON.stringify({
            id: 'scanned',
            label: hostLabel,
            origin: location.origin.replace(/\\/$/u, ''),
            accountKey: seededAccountKey,
          }))
        } catch { /* ignore */ }
      } catch { /* continue into app; WaitGate will retry */ }
      location.replace('/')
    } catch {
      fail('网络异常，请重新扫码')
    } finally {
      submitting = false
    }
  }
  if (supplied && /^[A-Za-z0-9_-]{43}$/u.test(supplied.trim())) {
    void pair(supplied.trim())
  } else {
    fail('请重新扫码')
  }
})()
`
}

/**
 * Resolve every on-disk dsh-mobile entry the Host might have loaded (avoid dual-package miss).
 * @returns {Promise<string[]>}
 */
async function resolveDshMobileEntryUrls() {
  /** @type {string[]} */
  const urls = []
  try {
    urls.push(import.meta.resolve('dsh-mobile'))
  } catch { /* optional */ }

  const home = dshHome()
  for (const profile of ['web', 'desktop']) {
    const file = join(home, 'profiles', profile, 'node_modules', 'dsh-mobile', 'lib', 'index.mjs')
    try {
      await access(file)
      urls.push(pathToFileURL(file).href)
    } catch { /* missing profile */ }
  }

  try {
    const require = createRequire(join(home, 'profiles', 'web', 'package.json'))
    const resolved = require.resolve('dsh-mobile')
    urls.push(pathToFileURL(resolved).href)
  } catch { /* optional */ }

  return [...new Set(urls)]
}

/**
 * @param {any} mod
 */
function patchDshMobileModule(mod) {
  const AccessController = mod.AccessController
  if (typeof AccessController === 'function' && AccessController.__t4yEnterpriseLabelHooked !== true) {
    AccessController.__t4yEnterpriseLabelHooked = true

    const track = (controller) => {
      accessControllers.add(controller)
    }

    for (const methodName of ['initialize', 'renew', 'probe', 'listDevices', 'openPairing', 'pairingStatus']) {
      const original = AccessController.prototype[methodName]
      if (typeof original !== 'function') continue
      AccessController.prototype[methodName] = function trackedMethod(...args) {
        track(this)
        return original.apply(this, args)
      }
    }

    const originalPair = AccessController.prototype.pair
    AccessController.prototype.pair = async function pair(sourceKey, token, label) {
      track(this)
      let nextLabel = label
      const displayName = await readHostDisplayName()
      // Prefer enterprise displayName whenever Host already has a shared session.
      if (displayName !== null) nextLabel = displayName
      else if (nextLabel === undefined || (typeof nextLabel === 'string' && nextLabel.trim() === '')) {
        nextLabel = '手机'
      }
      return originalPair.call(this, sourceKey, token, nextLabel)
    }

    /**
     * @param {string} deviceId
     * @param {string} label
     * @returns {Promise<{ updated: boolean, reason?: string, deviceId?: string, label?: string }>}
     */
    AccessController.prototype.applyEnterpriseDeviceLabel = async function applyEnterpriseDeviceLabel(deviceId, label) {
      this.requireInitialized()
      const normalized = normalizeEnterpriseLabel(label)
      return this.exclusive(async () => {
        const index = this.devices.findIndex((device) => device.id === deviceId)
        if (index < 0) return { updated: false, reason: 'not_found' }
        if (this.devices[index].label === normalized) {
          return { updated: false, reason: 'unchanged', deviceId, label: normalized }
        }
        const next = [...this.devices]
        next[index] = Object.freeze({ ...next[index], label: normalized })
        await this.store.save(this.snapshot(next))
        this.devices = next
        return { updated: true, deviceId, label: normalized }
      })
    }
  }

  const Gateway = mod.MobileAccessGateway
  if (typeof Gateway === 'function' && Gateway.__t4yEnterprisePairHooked !== true) {
    Gateway.__t4yEnterprisePairHooked = true
    const originalStart = Gateway.prototype.start
    if (typeof originalStart === 'function') {
      Gateway.prototype.start = async function t4yTunedStart(...args) {
        mobileGateways.add(this)
        // Raise before bind so the connection reject uses the new budget.
        try {
          if (this.config && typeof this.config === 'object') {
            this.config.maxConnections = Math.max(
              Number(this.config.maxConnections) || 0,
              GATEWAY_MAX_CONNECTIONS,
            )
          }
        } catch {
          // ignore
        }
        const result = await originalStart.apply(this, args)
        tuneGatewayInstance(this)
        return result
      }
    }
    const originalHandle = Gateway.prototype.handleExternalRequest
    if (typeof originalHandle === 'function') {
      Gateway.prototype.handleExternalRequest = async function handleExternalRequest(request, response) {
        if (!mobileGateways.has(this)) {
          mobileGateways.add(this)
          tuneGatewayInstance(this)
        }
        let pairingOpen = false
        try {
          pairingOpen = this.access.pairingStatus().open === true
        } catch {
          pairingOpen = false
        }
        if (tryHandlePublicMobileHttp(request, response, { pairingOpen })) {
          return
        }
        return originalHandle.call(this, request, response)
      }
    }
  }
}

/**
 * Run enter APIs in-process and write the Fetch Response onto the Gateway socket.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {'login' | 'select'} kind
 */
async function respondEnterApi(request, response, kind) {
  try {
    if (!isAccepting()) {
      writeJson(response, 503, { error: 'remote_off' }, request, true)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const headers = new Headers({ 'content-type': 'application/json' })
    // Prefer edge-forwarded client IP (Caddy/FRP); loopback peer would collapse all phones into one rate bucket.
    const forwarded = typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : ''
    if (forwarded !== '') headers.set('x-forwarded-for', forwarded)
    const peer = request.socket?.remoteAddress || 'local'
    headers.set('x-real-ip', peer)
    if (typeof request.headers.host === 'string') headers.set('host', request.headers.host)
    if (typeof request.headers['x-forwarded-host'] === 'string') {
      headers.set('x-forwarded-host', request.headers['x-forwarded-host'])
    }
    if (typeof request.headers['x-forwarded-proto'] === 'string') {
      headers.set('x-forwarded-proto', request.headers['x-forwarded-proto'])
    }
    const handler = kind === 'select' ? enterSelectHandler : enterLoginHandler
    if (typeof handler !== 'function') {
      writeJson(response, 503, { error: 'remote_off' }, request, true)
      return
    }
    const result = await handler(new Request(`http://dsh.local/api/t4y-mobile-enter/${kind}`, {
      method: 'POST',
      headers,
      body,
    }))
    const text = await result.text()
    const buffer = Buffer.from(text, 'utf8')
    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
      ...corsHeaders(),
    })
    response.end(buffer)
  } catch {
    writeJson(response, 502, { error: 'pair_failed' }, request, true)
  }
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function respondHandoffMint(request, response) {
  try {
    if (!isAccepting()) {
      writeJson(response, 503, { error: 'remote_off' }, request, true)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      writeJson(response, 400, { error: 'invalid_request' }, request, true)
      return
    }
    const payload = sanitizeHandoffPayload(body)
    if (!payload) {
      writeJson(response, 400, { error: 'invalid_request' }, request, true)
      return
    }
    const minted = mintHandoffTicket(payload)
    writeJson(response, 200, { ok: true, ...minted }, request, true)
  } catch {
    writeJson(response, 500, { error: 'handoff_mint_failed' }, request, true)
  }
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function respondHandoffRedeem(request, response) {
  try {
    if (!isAccepting()) {
      writeJson(response, 503, { error: 'remote_off' }, request, true)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      writeJson(response, 400, { error: 'invalid_request' }, request, true)
      return
    }
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const payload = redeemHandoffTicket(code)
    if (!payload) {
      writeJson(response, 404, { error: 'handoff_expired' }, request, true)
      return
    }
    writeJson(response, 200, { ok: true, switchAuth: payload }, request, true)
  } catch {
    writeJson(response, 500, { error: 'handoff_redeem_failed' }, request, true)
  }
}

/**
 * Intercept pair HTML/JS at the Node HTTP(S) server so QR opens the enterprise auto-bind page
 * even when dsh-mobile was loaded from a different module instance than this plugin.
 * Stores originals so plugin unload can restore prototypes.
 */
function installServerPairIntercept() {
  for (const Server of [http.Server, https.Server]) {
    if (!Server?.prototype) continue
    if (Server.__t4yEnterprisePairIntercept === true) continue
    const originalEmit = Server.prototype.emit
    Server.__t4yEnterprisePairOriginalEmit = originalEmit
    Server.__t4yEnterprisePairIntercept = true
    Server.prototype.emit = function t4yPairEmit(event, ...args) {
      if (event === 'request') {
        const req = args[0]
        const res = args[1]
        // pairingOpen omitted → require a tracked AccessController open window (same as Gateway).
        if (tryHandlePublicMobileHttp(req, res, { pairingOpen: null })) {
          return true
        }
      }
      return originalEmit.apply(this, [event, ...args])
    }
  }
}

/**
 * Undo process-global Server.emit patches installed by this plugin.
 */
function uninstallServerPairIntercept() {
  for (const Server of [http.Server, https.Server]) {
    if (!Server?.prototype || Server.__t4yEnterprisePairIntercept !== true) continue
    const original = Server.__t4yEnterprisePairOriginalEmit
    if (typeof original === 'function') {
      Server.prototype.emit = original
    }
    try {
      delete Server.__t4yEnterprisePairIntercept
      delete Server.__t4yEnterprisePairOriginalEmit
    } catch {
      Server.__t4yEnterprisePairIntercept = false
      Server.__t4yEnterprisePairOriginalEmit = undefined
    }
  }
}

/**
 * Patch dsh-mobile: empty pairing labels → enterprise displayName; QR pair page auto-binds.
 */
async function installAccessControllerHooks() {
  installServerPairIntercept()
  const urls = await resolveDshMobileEntryUrls()
  for (const url of urls) {
    try {
      const mod = await import(url)
      patchDshMobileModule(mod)
    } catch {
      // skip unresolved copies
    }
  }
  try {
    const mod = await import('dsh-mobile')
    patchDshMobileModule(mod)
  } catch {
    // dsh-mobile may be absent on profiles that only use LAN / lab overlays.
  }
}

/**
 * Best-effort: call loopback admin so patched listDevices captures live AccessController instances.
 * @param {import('cordis').Context} ctx
 */
async function nudgeTrackControllers(ctx) {
  if (accessControllers.size > 0) return
  await installAccessControllerHooks()
  /** @type {number | null} */
  let port = null
  try {
    const webServer = ctx.get('webServer')
    if (webServer && typeof webServer.port === 'number') port = webServer.port
  } catch {
    port = null
  }
  const candidates = [
    port !== null ? `http://127.0.0.1:${port}/api/mobile-access/devices` : null,
    'http://127.0.0.1:3080/api/mobile-access/devices',
  ].filter((value) => typeof value === 'string')
  for (const url of candidates) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) })
    } catch {
      // ignore — nudge only
    }
    if (accessControllers.size > 0) return
  }
}

/**
 * Durable fallback when AccessController instances are not yet tracked.
 * @param {string} displayName
 * @param {string | null} preferredDeviceId
 */
async function rewriteDevicesFile(displayName, preferredDeviceId) {
  const normalized = normalizeEnterpriseLabel(displayName)
  const file = devicesPath()
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { updated: false, reason: 'devices_missing' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { updated: false, reason: 'devices_invalid' }
  }
  if (!parsed || !Array.isArray(parsed.devices)) return { updated: false, reason: 'devices_invalid' }
  const now = Date.now()
  const active = parsed.devices
    .filter((device) => device && typeof device.id === 'string' && device.revokedAt === undefined && (typeof device.expiresAt !== 'number' || device.expiresAt > now))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  const target = preferredDeviceId
    ? active.find((device) => device.id === preferredDeviceId)
    : (active.find((device) => GENERIC_LABELS.has(device.label)) ?? active[0])
  if (!target) return { updated: false, reason: 'no_device' }
  if (target.label === normalized) return { updated: false, reason: 'unchanged', deviceId: target.id, label: normalized }

  const nextDevices = parsed.devices.map((device) => (
    device.id === target.id ? { ...device, label: normalized } : device
  ))
  const body = `${JSON.stringify({ ...parsed, devices: nextDevices })}\n`
  const directory = dirname(file)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${basename(file)}.${randomBytes(8).toString('hex')}.tmp`)
  await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await renameFile(temporary, file)
  return { updated: true, deviceId: target.id, label: normalized, via: 'devices.json' }
}

/**
 * @param {string} displayName
 * @param {string | null} preferredDeviceId
 */
async function applyLabelToControllers(displayName, preferredDeviceId) {
  const normalized = normalizeEnterpriseLabel(displayName)
  const results = []
  for (const controller of [...accessControllers]) {
    if (typeof controller.applyEnterpriseDeviceLabel !== 'function') continue
    try {
      if (preferredDeviceId) {
        results.push(await controller.applyEnterpriseDeviceLabel(preferredDeviceId, normalized))
        continue
      }
      const now = Date.now()
      const devices = typeof controller.listDevices === 'function' ? controller.listDevices() : []
      const active = devices
        .filter((device) => device.revokedAt === undefined && device.expiresAt > now)
        .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
      const target = active.find((device) => GENERIC_LABELS.has(device.label)) ?? active[0]
      if (!target) {
        results.push({ updated: false, reason: 'no_device' })
        continue
      }
      results.push(await controller.applyEnterpriseDeviceLabel(target.id, normalized))
    } catch (error) {
      results.push({
        updated: false,
        reason: error instanceof Error ? error.message : 'apply_failed',
      })
    }
  }
  return results
}

/**
 * @param {import('cordis').Context} ctx
 */
export function apply(ctx) {
  loadAcceptingSync()
  installServerPairIntercept()
  const enterOptions = { isAccepting }
  enterLoginHandler = async (request) => {
    try {
      await nudgeTrackControllers(ctx)
      return await handleEnterLogin(ctx, request, accessControllers, enterOptions)
    } catch (error) {
      return json(500, {
        error: error instanceof Error ? error.message : 'enter_failed',
      })
    }
  }
  enterSelectHandler = async (request) => {
    try {
      await nudgeTrackControllers(ctx)
      return await handleEnterSelect(ctx, request, accessControllers, enterOptions)
    } catch (error) {
      return json(500, {
        error: error instanceof Error ? error.message : 'enter_failed',
      })
    }
  }
  ctx.effect(() => () => {
    enterLoginHandler = null
    enterSelectHandler = null
    uninstallServerPairIntercept()
  }, 't4y-mobile-enter: clear handler + server intercept')

  void installAccessControllerHooks().then(() => {
    tuneLiveGatewayServers()
  })
  // Gateway may finish listen after this plugin; retry a few times without blocking boot.
  ctx.effect(() => {
    const timers = [0, 2_000, 8_000].map((ms) => setTimeout(() => {
      tuneLiveGatewayServers()
    }, ms))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  })

  // Desktop/loopback convenience (still subject to Web auth). Phone uses Gateway intercept.
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-enter/login',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        await nudgeTrackControllers(ctx)
        return await handleEnterLogin(ctx, request, accessControllers, enterOptions)
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'enter_failed',
        })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-enter/select',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        await nudgeTrackControllers(ctx)
        return await handleEnterSelect(ctx, request, accessControllers, enterOptions)
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'enter_failed',
        })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-enter/host-card',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const origin = (() => {
          try {
            return new URL(request.url).origin
          } catch {
            return null
          }
        })()
        return await handleHostCard(isAccepting(), origin)
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'host_card_failed',
        })
      }
    },
  })

  /**
   * After QR pair: mint session-only switchAuth from disk host-session.
   * host-session GET stays public-placeholder; this is the sole phone redeem seed.
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/switch-auth-seed',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        if (!isAccepting()) return json(503, { error: 'remote_off' })
        const file = join(dshHome(), 't4y-identity', 'host-session.json')
        let parsed
        try {
          parsed = JSON.parse(await readFile(file, 'utf8'))
        } catch {
          return json(404, { error: 'no_switch_auth' })
        }
        const session = parsed?.session && typeof parsed.session === 'object' ? parsed.session : parsed
        const accessToken = typeof session?.accessToken === 'string' ? session.accessToken.trim() : ''
        if (accessToken === '' || accessToken === 'mobile-cowatch') {
          return json(404, { error: 'no_switch_auth' })
        }
        const expiresAt = typeof session.expiresAt === 'number' && session.expiresAt > Date.now()
          ? session.expiresAt
          : Date.now() + 8 * 3600_000
        const enterpriseName = typeof session.enterpriseName === 'string' ? session.enterpriseName : ''
        const userName = typeof session.username === 'string' ? session.username : ''
        return json(200, {
          switchAuth: {
            accessToken,
            enterpriseName,
            userName,
            accountKey: accountKeyOf(enterpriseName, userName),
            expiresAt,
            at: Date.now(),
            via: 'qr-seed',
          },
        })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'switch_auth_seed_failed',
        })
      }
    },
  })

  /**
   * Cross-origin enter: mint a one-time code on the *target* Host (CORS, no cookie).
   * Caller then opens `/t4y-mobile-enter#handoff=<code>` — never puts accessToken in the URL.
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/handoff-mint',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (!isAccepting()) return json(503, { error: 'remote_off' })
        let body
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'invalid_request' })
        }
        const payload = sanitizeHandoffPayload(body)
        if (!payload) return json(400, { error: 'invalid_request' })
        const minted = mintHandoffTicket(payload)
        return json(200, { ok: true, ...minted })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'handoff_mint_failed',
        })
      }
    },
  })

  /**
   * Redeem a one-time handoff code into switchAuth (consumed).
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/handoff-redeem',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (!isAccepting()) return json(503, { error: 'remote_off' })
        let body
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'invalid_request' })
        }
        const code = typeof body?.code === 'string' ? body.code.trim() : ''
        const payload = redeemHandoffTicket(code)
        if (!payload) return json(404, { error: 'handoff_expired' })
        return json(200, { ok: true, switchAuth: payload })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'handoff_redeem_failed',
        })
      }
    },
  })

  /**
   * Phone project switch: update PC host-session + Host workspace context using the
   * real desktop token (never exposed to the phone).
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/switch-module',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (!isAccepting()) return json(503, { error: 'remote_off' })
        // Paired phone / Host cookie only — reject anonymous callers.
        const cookie = request.headers.get('cookie') || ''
        if (cookie.trim() === '') {
          return json(401, { error: 'authorization_required' })
        }
        let body
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'invalid_request' })
        }
        const moduleId = typeof body?.moduleId === 'string' ? body.moduleId.trim() : ''
        if (moduleId === '') return json(400, { error: 'invalid_request' })

        const file = join(dshHome(), 't4y-identity', 'host-session.json')
        let parsed
        try {
          parsed = JSON.parse(await readFile(file, 'utf8'))
        } catch {
          return json(409, { error: 'host_not_ready' })
        }
        const session = parsed?.session && typeof parsed.session === 'object' ? parsed.session : parsed
        if (!session || typeof session !== 'object') return json(409, { error: 'host_not_ready' })
        const modules = Array.isArray(session.modules) ? session.modules : []
        const selected = modules.find((item) => item && item.id === moduleId)
        if (!selected) return json(404, { error: 'module_not_found' })

        const nextSession = {
          ...session,
          moduleId: selected.id,
          moduleName: typeof selected.name === 'string' ? selected.name : selected.id,
          moduleLogo: selected.logo || selected.favicon || session.moduleLogo || null,
          needsModulePick: false,
        }
        const nextDoc = parsed?.session
          ? { ...parsed, session: nextSession, updatedAt: Date.now() }
          : { version: 1, updatedAt: Date.now(), session: nextSession }
        const directory = dirname(file)
        await mkdir(directory, { recursive: true })
        const temporary = join(directory, `.host-session.${randomBytes(8).toString('hex')}.tmp`)
        await writeFile(temporary, `${JSON.stringify(nextDoc)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await renameFile(temporary, file)

        const accessToken = typeof nextSession.accessToken === 'string' ? nextSession.accessToken : ''
        const loopback = hostLoopbackBase(ctx)
        if (accessToken !== '' && accessToken !== 'mobile-cowatch') {
          const headers = {
            Authorization: accessToken,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }
          try {
            await fetch(`${loopback}/api/t4y-identity/set-context`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                tenantId: nextSession.tenantId,
                moduleId: nextSession.moduleId,
                reason: 'mobile-switch-module',
              }),
              signal: AbortSignal.timeout(8_000),
            })
          } catch { /* best-effort */ }
          try {
            await fetch(`${loopback}/api/t4y-identity/project-workspace`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                moduleId: nextSession.moduleId,
                title: nextSession.moduleName || nextSession.moduleId,
              }),
              signal: AbortSignal.timeout(12_000),
            })
          } catch { /* best-effort */ }
          try {
            await fetch(`${loopback}/api/t4y-release/apply-module`, {
              method: 'POST',
              headers: {
                'X-T4Y-Access-Token': accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ moduleId: nextSession.moduleId }),
              signal: AbortSignal.timeout(12_000),
            })
          } catch { /* best-effort */ }
        }

        const hostReady = await buildPublicHostReady(nextSession, ctx)
        return json(200, { ok: true, session: hostReady.session, modelKeyPresent: hostReady.modelKeyPresent })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'switch_module_failed',
        })
      }
    },
  })

  // Soft-off switch for desktop menu (cookie-authed Host). Phone polls the public status route.
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/accepting',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request.method === 'GET') {
          return json(200, { accepting: isAccepting() })
        }
        let body
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'invalid_request' })
        }
        if (typeof body?.accepting !== 'boolean') {
          return json(400, { error: 'invalid_request' })
        }
        await nudgeTrackControllers(ctx)
        const result = await setAccepting(body.accepting)
        return json(200, result)
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'accepting_failed',
        })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/credential-status',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const resolved = await ctx.credentials.resolve(MODEL_CREDENTIAL_REF)
        const present = typeof resolved?.value === 'string' && resolved.value !== ''
        return json(200, { present, ref: MODEL_CREDENTIAL_REF })
      } catch {
        return json(200, { present: false, ref: MODEL_CREDENTIAL_REF })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/bind-device-label',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        let body
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'invalid_request' })
        }
        const fromBody = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
        const displayName = fromBody !== '' ? fromBody.slice(0, 64) : await readHostDisplayName()
        if (!displayName) return json(400, { error: 'display_name_required' })

        const preferredDeviceId = typeof body?.deviceId === 'string' && /^[a-f\d]{32}$/u.test(body.deviceId)
          ? body.deviceId
          : deviceIdFromRequest(request)

        // Prefer durable file rewrite first (works even when AccessController is not tracked yet).
        const fileResult = await rewriteDevicesFile(displayName, preferredDeviceId)
        await nudgeTrackControllers(ctx)
        const memoryResults = await applyLabelToControllers(
          displayName,
          preferredDeviceId || (typeof fileResult.deviceId === 'string' ? fileResult.deviceId : null),
        )
        const results = [fileResult, ...memoryResults]
        const updated = results.some((result) => result.updated === true)
        return json(200, {
          updated,
          displayName,
          deviceId: preferredDeviceId,
          results,
        })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'bind_failed',
        })
      }
    },
  })
}

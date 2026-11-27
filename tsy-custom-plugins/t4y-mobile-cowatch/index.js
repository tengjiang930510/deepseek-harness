/**
 * Host half for mobile co-watch: expose whether the PC already holds the model key,
 * and surface connected phones as model + short id (account is secondary).
 */
import { readFileSync } from 'node:fs'
import { readFile, writeFile, rename as renameFile, mkdir, access } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
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
import { ensurePerHostPublicOrigin } from './per-host-origin.js'
import { ensureFrpRuntimeGuard } from './frp-guard.js'

export const name = 't4y-mobile-cowatch'
export const inject = {
  connection: true,
  credentials: true,
  webServer: { required: false },
}

const MODEL_CREDENTIAL_REF = 'T4Y_NEW_API_KEY'
const GENERIC_LABELS = new Set(['Mobile device', 'DeepSeek Harness Android', '1', 'test1', '手机', '浏览器'])

/**
 * @returns {string}
 */
function deviceMetaPath() {
  return join(dshHome(), 'mobile-access', 't4y-device-meta.json')
}

const COARSE_DEVICE_MODELS = new Set([
  'iPhone', 'iPad', 'Android', '手机', '浏览器', 'Mac', 'Windows', 'Windows Phone', '华为',
  'Mobile device', 'DeepSeek Harness Android', '1', 'test1',
])

/**
 * True when the label is a concrete handset model (e.g. VER-AN10, SM-S9180), not a class name.
 * @param {string} model
 * @returns {boolean}
 */
export function isConcretePhoneModel(model) {
  const m = String(model || '').trim()
  if (m.length < 3 || m.length > 32) return false
  if (COARSE_DEVICE_MODELS.has(m) || GENERIC_LABELS.has(m)) return false
  return true
}

/**
 * Derive a short device model name from a User-Agent (or client-supplied model).
 * @param {string} userAgent
 * @returns {string}
 */
export function modelFromUserAgent(userAgent) {
  const ua = String(userAgent || '')
  const fromBuild = ua.match(/;\s*([^;)]+?)\s+Build\//i)
  if (fromBuild?.[1]) {
    const name = fromBuild[1].trim().replace(/\s+/g, ' ')
    if (name && name.length <= 32 && !/^wv$/i.test(name)) return name.slice(0, 32)
  }
  // Some WebViews omit "Build/" but still put the model after "Android x;".
  const fromAndroid = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)
  if (fromAndroid?.[1]) {
    const name = fromAndroid[1].trim().replace(/\s+/g, ' ')
    if (
      name
      && name.length <= 32
      && !/^wv$/i.test(name)
      && !/^(U|zh-cn|zh-tw|en-us)$/i.test(name)
    ) {
      return name.slice(0, 32)
    }
  }
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/HarmonyOS|HUAWEI/i.test(ua)) return '华为'
  if (/Windows Phone/i.test(ua)) return 'Windows Phone'
  if (/Mobile|phone/i.test(ua)) return '手机'
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return '浏览器'
}

/**
 * @param {string} deviceId
 * @returns {string}
 */
export function shortDeviceId(deviceId) {
  const id = String(deviceId || '')
  return id.length >= 8 ? id.slice(0, 8) : id
}

/**
 * @param {{ model?: string, shortId?: string, account?: string, id?: string, label?: string }} row
 * @returns {string}
 */
export function formatDeviceDisplay(row) {
  const model = typeof row.model === 'string' && row.model.trim() !== ''
    ? row.model.trim()
    : (typeof row.label === 'string' && row.label.trim() !== '' && !GENERIC_LABELS.has(row.label.trim())
      ? row.label.trim()
      : '手机')
  const shortId = typeof row.shortId === 'string' && row.shortId !== ''
    ? row.shortId
    : shortDeviceId(typeof row.id === 'string' ? row.id : '')
  const base = shortId ? `${model} · ${shortId}` : model
  const account = typeof row.account === 'string' ? row.account.trim() : ''
  if (account !== '' && account !== model) return `${base}（${account}）`
  return base
}

/** @type {{ at: number, meta: { version: 1, byDeviceId: Record<string, object>, byFingerprint: Record<string, string> } | null }} */
const deviceMetaCache = { at: 0, meta: null }
const DEVICE_META_CACHE_MS = 2_000

/**
 * @returns {{ version: 1, byDeviceId: Record<string, object>, byFingerprint: Record<string, string> }}
 */
function loadDeviceMetaSync() {
  const now = Date.now()
  if (deviceMetaCache.meta && now - deviceMetaCache.at < DEVICE_META_CACHE_MS) {
    return deviceMetaCache.meta
  }
  try {
    const parsed = JSON.parse(readFileSync(deviceMetaPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
    const meta = {
      version: 1,
      byDeviceId: parsed.byDeviceId && typeof parsed.byDeviceId === 'object' ? parsed.byDeviceId : {},
      byFingerprint: parsed.byFingerprint && typeof parsed.byFingerprint === 'object' ? parsed.byFingerprint : {},
    }
    deviceMetaCache.at = now
    deviceMetaCache.meta = meta
    return meta
  } catch {
    const empty = { version: 1, byDeviceId: {}, byFingerprint: {} }
    deviceMetaCache.at = now
    deviceMetaCache.meta = empty
    return empty
  }
}

/**
 * @param {{ version: 1, byDeviceId: Record<string, object>, byFingerprint: Record<string, string> }} meta
 */
async function saveDeviceMeta(meta) {
  const file = deviceMetaPath()
  await mkdir(dirname(file), { recursive: true })
  const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(8).toString('hex')}.tmp`)
  const body = `${JSON.stringify({
    version: 1,
    byDeviceId: meta.byDeviceId,
    byFingerprint: meta.byFingerprint,
  })}\n`
  await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await renameFile(temporary, file)
  deviceMetaCache.at = 0
  deviceMetaCache.meta = null
}

/**
 * @param {string} deviceId
 * @param {{ model?: string, fingerprint?: string, account?: string, userAgent?: string }} patch
 */
async function upsertDeviceMeta(deviceId, patch) {
  if (typeof deviceId !== 'string' || !/^[a-f\d]{32}$/u.test(deviceId)) return null
  const meta = loadDeviceMetaSync()
  const prev = meta.byDeviceId[deviceId] && typeof meta.byDeviceId[deviceId] === 'object'
    ? /** @type {Record<string, unknown>} */ (meta.byDeviceId[deviceId])
    : {}
  const model = typeof patch.model === 'string' && patch.model.trim() !== ''
    ? patch.model.trim().slice(0, 32)
    : (typeof prev.model === 'string' ? prev.model : '手机')
  const fingerprint = typeof patch.fingerprint === 'string' && patch.fingerprint.trim() !== ''
    ? patch.fingerprint.trim().slice(0, 96)
    : (typeof prev.fingerprint === 'string' ? prev.fingerprint : '')
  const account = typeof patch.account === 'string'
    ? patch.account.trim().slice(0, 64)
    : (typeof prev.account === 'string' ? prev.account : '')
  const userAgent = typeof patch.userAgent === 'string'
    ? patch.userAgent.slice(0, 256)
    : (typeof prev.userAgent === 'string' ? prev.userAgent : '')
  const row = {
    model,
    shortId: shortDeviceId(deviceId),
    fingerprint,
    account,
    userAgent,
    updatedAt: Date.now(),
  }
  meta.byDeviceId[deviceId] = row
  if (fingerprint) {
    const previousId = meta.byFingerprint[fingerprint]
    meta.byFingerprint[fingerprint] = deviceId
    if (typeof previousId === 'string' && previousId !== deviceId) {
      // Keep previous row for history; revocation happens separately.
    }
  }
  await saveDeviceMeta(meta)
  return row
}

/**
 * @param {string[]} victims
 * @returns {Promise<string[]>}
 */
async function revokeDeviceIds(victims) {
  /** @type {string[]} */
  const revoked = []
  for (const id of [...new Set(victims)]) {
    phonePresence.delete(id)
    let ok = false
    for (const controller of [...accessControllers]) {
      if (typeof controller.revokeDevice !== 'function') continue
      try {
        if (await controller.revokeDevice(id)) ok = true
      } catch {
        // try next controller
      }
    }
    if (ok) revoked.push(id)
  }
  return revoked
}

/**
 * Revoke every other durable device that shares this phone fingerprint.
 * @param {string} fingerprint
 * @param {string} keepDeviceId
 * @returns {Promise<string[]>}
 */
async function revokeDevicesWithFingerprint(fingerprint, keepDeviceId) {
  if (!fingerprint) return []
  const meta = loadDeviceMetaSync()
  /** @type {string[]} */
  const victims = []
  for (const [id, row] of Object.entries(meta.byDeviceId)) {
    if (id === keepDeviceId) continue
    if (row && typeof row === 'object' && /** @type {any} */ (row).fingerprint === fingerprint) {
      victims.push(id)
    }
  }
  const pointed = meta.byFingerprint[fingerprint]
  if (typeof pointed === 'string' && pointed !== keepDeviceId && !victims.includes(pointed)) {
    victims.push(pointed)
  }
  const revoked = await revokeDeviceIds(victims)
  meta.byFingerprint[fingerprint] = keepDeviceId
  await saveDeviceMeta(meta)
  return revoked
}

/**
 * Same concrete handset model (VER-AN10) → one live device. Also drops legacy generic orphans
 * for the same account (「手机」rows left by browsers that never exposed Build/).
 * @param {{ fingerprint?: string, model?: string, account?: string, keepDeviceId: string }} input
 * @returns {Promise<string[]>}
 */
async function revokeSiblingPhoneDevices(input) {
  const keepDeviceId = input.keepDeviceId
  const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim() : ''
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  const account = typeof input.account === 'string' ? input.account.trim() : ''
  const concrete = isConcretePhoneModel(model)
  /** @type {string[]} */
  const fromFp = fingerprint ? await revokeDevicesWithFingerprint(fingerprint, keepDeviceId) : []

  const meta = loadDeviceMetaSync()
  /** @type {string[]} */
  const victims = []
  for (const [id, row] of Object.entries(meta.byDeviceId)) {
    if (id === keepDeviceId) continue
    if (!row || typeof row !== 'object') continue
    const r = /** @type {Record<string, unknown>} */ (row)
    const rowModel = typeof r.model === 'string' ? r.model.trim() : ''
    const rowAccount = typeof r.account === 'string' ? r.account.trim() : ''
    if (concrete && rowModel === model) {
      victims.push(id)
      continue
    }
  }
  const androidCoarse = new Set([
    '手机', 'Android', '华为', '浏览器', 'Mobile device', 'DeepSeek Harness Android',
  ])
  if (concrete && account !== '') {
    for (const [id, row] of Object.entries(meta.byDeviceId)) {
      if (id === keepDeviceId) continue
      if (!row || typeof row !== 'object') continue
      const r = /** @type {Record<string, unknown>} */ (row)
      const rowModel = typeof r.model === 'string' ? r.model.trim() : ''
      const rowAccount = typeof r.account === 'string' ? r.account.trim() : ''
      if (rowAccount === account && (rowModel === '' || androidCoarse.has(rowModel))) {
        victims.push(id)
      }
    }
  }
  for (const controller of [...accessControllers]) {
    if (typeof controller.listDevices !== 'function') continue
    try {
      const devices = controller.listDevices()
      if (!Array.isArray(devices)) continue
      for (const device of devices) {
        if (!device || typeof device !== 'object') continue
        const row = /** @type {Record<string, unknown>} */ (device)
        if (typeof row.id !== 'string' || row.id === keepDeviceId) continue
        if (row.revokedAt !== undefined && row.revokedAt !== null) continue
        const label = typeof row.label === 'string' ? row.label.trim() : ''
        if (concrete && label === model) {
          victims.push(row.id)
          continue
        }
        if (!concrete || account === '' || !androidCoarse.has(label)) continue
        const metaRow = meta.byDeviceId[row.id]
        const metaAccount = metaRow && typeof metaRow === 'object'
          && typeof /** @type {any} */ (metaRow).account === 'string'
          ? /** @type {any} */ (metaRow).account.trim()
          : ''
        // Same account's leftover「手机」rows from browsers that never exposed Build/.
        if (metaAccount === account) victims.push(row.id)
      }
    } catch {
      // try next
    }
  }

  const revoked = await revokeDeviceIds(victims)
  if (fingerprint) {
    const next = loadDeviceMetaSync()
    next.byFingerprint[fingerprint] = keepDeviceId
    await saveDeviceMeta(next)
  }
  return [...new Set([...fromFp, ...revoked])]
}

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
const GATEWAY_MAX_CONNECTIONS = 512
/** Stock dsh-mobile hardcodes 5s; longer reuse cuts TIME_WAIT churn through FRP. */
const GATEWAY_KEEP_ALIVE_MS = 65_000
/** Match dsh-mobile mobile-boot layout id (not exported from the bundle). */
const MOBILE_LAYOUT_MODULE_ID = '@deepseek-ai/dsh-client-ui-layout'
/** Stock assembles with 3 parallel upstream reads; loopback ECONNRESET blanks the phone boot. */
const MOBILE_BOOT_SEPARATOR = Buffer.from('\n;\n')
const MAX_MOBILE_BOOT_ENTRY_BYTES = 8_388_608

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

/** Soft-off keeps FRP briefly so phones can still load「电脑不在线」. Host guard must honor this. */
const SOFT_OFF_FRP_GRACE_MS = 60_000
/** Another Host's accepting heartbeat is stale after this (shared frps slot). */
const ACCEPTING_HOLDER_STALE_MS = 45_000

/** @type {number | null} */
let frpReleaseAtMs = null

/** Stable id for this Host process (Web vs Desktop share ~/.dsh accepting file). */
const ACCEPTING_INSTANCE_ID = randomUUID()
const ACCEPTING_HOLDER_KIND = process.versions?.electron ? 'desktop' : 'web'

/**
 * @returns {boolean}
 */
function isAccepting() {
  return acceptingEngagements === true
}

/**
 * Whether Host should keep frpc alive (accepting, or still inside soft-off grace).
 * @returns {boolean}
 */
function shouldKeepFrpAlive() {
  if (acceptingEngagements === true) return true
  return typeof frpReleaseAtMs === 'number' && Number.isFinite(frpReleaseAtMs) && Date.now() < frpReleaseAtMs
}

/**
 * @param {unknown} parsed
 * @returns {{ accepting: boolean, holderId: string, holderKind: string, heartbeatAt: number, frpReleaseAt: number | null }}
 */
function normalizeAcceptingFile(parsed) {
  const heartbeatAt = typeof parsed?.heartbeatAt === 'number' && Number.isFinite(parsed.heartbeatAt)
    ? parsed.heartbeatAt
    : (typeof parsed?.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0)
  const releaseAt = parsed?.frpReleaseAt
  return {
    accepting: parsed?.accepting !== false,
    holderId: typeof parsed?.holderId === 'string' ? parsed.holderId : '',
    holderKind: parsed?.holderKind === 'desktop' ? 'desktop' : 'web',
    heartbeatAt,
    frpReleaseAt: typeof releaseAt === 'number' && Number.isFinite(releaseAt) ? releaseAt : null,
  }
}

/**
 * Fresh foreign holder still owns the shared FRP slot.
 * @param {ReturnType<typeof normalizeAcceptingFile>} state
 * @returns {boolean}
 */
function foreignHolderActive(state) {
  if (!state.accepting) return false
  if (state.holderId === '' || state.holderId === ACCEPTING_INSTANCE_ID) return false
  return Date.now() - state.heartbeatAt < ACCEPTING_HOLDER_STALE_MS
}

/**
 * Synchronous boot load so public intercepts never race an open default.
 * Missing file → first install defaults to accepting (Desktop) or yields when Desktop holds the slot (Web).
 * @returns {boolean}
 */
function loadAcceptingSync() {
  try {
    const parsed = normalizeAcceptingFile(JSON.parse(readFileSync(acceptingPath(), 'utf8')))
    if (foreignHolderActive(parsed)) {
      // Product rule: one accepting Host per FRP account. Prefer Desktop; Web stays soft-off.
      if (ACCEPTING_HOLDER_KIND === 'web' || parsed.holderKind === 'desktop') {
        acceptingEngagements = false
        frpReleaseAtMs = parsed.frpReleaseAt
        return acceptingEngagements
      }
    }
    acceptingEngagements = parsed.accepting
    frpReleaseAtMs = parsed.frpReleaseAt
    if (acceptingEngagements) frpReleaseAtMs = null
  } catch {
    acceptingEngagements = true
    frpReleaseAtMs = null
  }
  return acceptingEngagements
}

/**
 * @returns {Promise<boolean>}
 */
async function loadAccepting() {
  return loadAcceptingSync()
}

class AcceptingSlotBusyError extends Error {
  /**
   * @param {{ holderKind?: string }} [detail]
   */
  constructor(detail = {}) {
    super('accepting_slot_busy')
    this.name = 'AcceptingSlotBusyError'
    this.holderKind = detail.holderKind === 'desktop' ? 'desktop' : 'web'
  }
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
 * Turning on fails with AcceptingSlotBusyError when another Host still holds the slot.
 * @param {boolean} accepting
 * @param {{ heartbeatOnly?: boolean }} [options]
 * @returns {Promise<{ accepting: boolean, revoked: number, frpReleaseAt: number | null, holderId: string, holderKind: string }>}
 */
async function setAccepting(accepting, options = {}) {
  const wantOn = accepting === true
  const file = acceptingPath()
  let existing = null
  try {
    existing = normalizeAcceptingFile(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    existing = null
  }
  if (wantOn && existing && foreignHolderActive(existing)) {
    // Desktop may reclaim from Web; Web must not steal from Desktop or another Web.
    const desktopReclaim = ACCEPTING_HOLDER_KIND === 'desktop' && existing.holderKind === 'web'
    if (!desktopReclaim) {
      throw new AcceptingSlotBusyError({ holderKind: existing.holderKind })
    }
  }
  if (options.heartbeatOnly === true && !wantOn) {
    throw new Error('accepting_heartbeat_requires_on')
  }
  acceptingEngagements = wantOn
  const now = Date.now()
  if (!options.heartbeatOnly) {
    frpReleaseAtMs = acceptingEngagements ? null : now + SOFT_OFF_FRP_GRACE_MS
  } else if (acceptingEngagements) {
    frpReleaseAtMs = null
  }
  await mkdir(dirname(file), { recursive: true })
  const body = `${JSON.stringify({
    accepting: acceptingEngagements,
    updatedAt: now,
    heartbeatAt: now,
    holderId: ACCEPTING_INSTANCE_ID,
    holderKind: ACCEPTING_HOLDER_KIND,
    frpReleaseAt: frpReleaseAtMs,
  })}\n`
  const temporary = join(dirname(file), `.t4y-accepting.${randomBytes(8).toString('hex')}.tmp`)
  await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await renameFile(temporary, file)
  let revoked = 0
  if (!acceptingEngagements && options.heartbeatOnly !== true) {
    revoked = await revokeAllMobileDevices()
  }
  return {
    accepting: acceptingEngagements,
    revoked,
    frpReleaseAt: frpReleaseAtMs,
    holderId: ACCEPTING_INSTANCE_ID,
    holderKind: ACCEPTING_HOLDER_KIND,
  }
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
      || pathname === '/api/t4y-mobile-cowatch/handoff-redeem'
      || pathname === '/api/t4y-mobile-cowatch/presence'
      || pathname === '/api/t4y-mobile-cowatch/register-device')
  ) {
    res.writeHead(204, {
      ...corsHeaders(),
      'Access-Control-Allow-Headers': 'content-type, x-dsh-mobile-csrf',
    })
    res.end()
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-cowatch/presence') {
    void respondPublicPresence(req, res)
    return true
  }
  if (method === 'POST' && pathname === '/api/t4y-mobile-cowatch/register-device') {
    void respondRegisterDevice(req, res)
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
      // Stock dsh-mobile answers closed pairing with `{"error":"not_found"}`.
      // Always serve the enterprise closed page instead (Host and Gateway).
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
  <p>这张码已用过、已过期，或电脑已换了新码。请到<strong>要连接的那台电脑</strong>账号菜单打开「移动访问」，点「刷新二维码」后再扫。</p>
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
 * @param {string} cookie
 * @returns {string | null}
 */
function deviceIdFromCookieHeader(cookie) {
  const host = String(cookie || '').match(/(?:^|;\s*)__Host-dsh_ma_device_id=([^;]+)/)
  if (host?.[1]) {
    try {
      return decodeURIComponent(host[1].trim())
    } catch {
      return host[1].trim()
    }
  }
  const plain = String(cookie || '').match(/(?:^|;\s*)dsh_ma_device_id=([^;]+)/)
  if (plain?.[1]) {
    try {
      return decodeURIComponent(plain[1].trim())
    } catch {
      return plain[1].trim()
    }
  }
  return null
}

/**
 * @param {Request} request
 * @returns {string | null}
 */
function deviceIdFromRequest(request) {
  return deviceIdFromCookieHeader(request.headers.get('cookie') || '')
}

/** After an explicit leave beacon, ignore ambient cookie traffic briefly so「已连接」can clear. */
const LEAVE_SUPPRESS_MS = 30_000
/** @type {Map<string, number>} */
const phoneLeftAt = new Map()

/**
 * Mark a paired phone online from any Gateway/Host request that carries its device cookie.
 * Keep this path cheap: mobile-boot fans out dozens of requests; sync disk/meta work here
 * stalls the event loop and upstream reads then ECONNRESET →「Failed to load plugins」.
 * Only refreshes an existing presence row — pair / register / presence enter create it.
 * @param {import('node:http').IncomingMessage | undefined} request
 */
function noteDeviceActivityFromNodeRequest(request) {
  const deviceId = deviceIdFromCookieHeader(String(request?.headers?.cookie || ''))
  if (!deviceId) return
  const leftAt = phoneLeftAt.get(deviceId)
  if (typeof leftAt === 'number' && Date.now() - leftAt < LEAVE_SUPPRESS_MS) return
  const existing = phonePresence.get(deviceId)
  if (!existing) return
  if (Date.now() - existing.at < 8_000) {
    existing.at = Date.now()
    return
  }
  setPhonePresence(deviceId, true)
}

/**
 * Public FRP presence (paired device cookie). Avoids Host CSRF on the phone path.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function respondPublicPresence(request, response) {
  try {
    const deviceId = deviceIdFromCookieHeader(String(request.headers.cookie || ''))
    if (!deviceId) {
      writeJson(response, 401, { error: 'device_required' }, request, true)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let online = true
    if (chunks.length > 0) {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (body && typeof body.online === 'boolean') online = body.online
      } catch {
        // empty / keepalive leave body → online beat
      }
    }
    const accepted = setPhonePresence(deviceId, online)
    if (online && !accepted) {
      writeJson(response, 401, { error: 'device_revoked' }, request, true)
      return
    }
    writeJson(response, 200, { ok: true, online: accepted && online, deviceId }, request, true)
  } catch {
    writeJson(response, 500, { error: 'presence_failed' }, request, true)
  }
}

/**
 * Phone registers model + stable fingerprint after pair; same fingerprint revokes older devices.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function respondRegisterDevice(request, response) {
  try {
    const deviceId = deviceIdFromCookieHeader(String(request.headers.cookie || ''))
    if (!deviceId || !/^[a-f\d]{32}$/u.test(deviceId)) {
      writeJson(response, 401, { error: 'device_required' }, request, true)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    /** @type {Record<string, unknown>} */
    let body = {}
    if (chunks.length > 0) {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (parsed && typeof parsed === 'object') body = /** @type {Record<string, unknown>} */ (parsed)
      } catch {
        writeJson(response, 400, { error: 'invalid_request' }, request, true)
        return
      }
    }
    const userAgent = String(request.headers['user-agent'] || '')
    const modelRaw = typeof body.model === 'string' ? body.model.trim().slice(0, 32) : ''
    const model = modelRaw !== '' ? modelRaw : modelFromUserAgent(userAgent)
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim().slice(0, 96) : ''
    const accountRaw = typeof body.account === 'string' ? body.account.trim().slice(0, 64) : ''
    const account = accountRaw !== '' ? accountRaw : (await readHostDisplayName() || '')
    // Prefer UA-derived concrete model when the client only sent「手机」.
    const uaModel = modelFromUserAgent(userAgent)
    const effectiveModel = isConcretePhoneModel(model)
      ? model
      : (isConcretePhoneModel(uaModel) ? uaModel : model)
    const effectiveFingerprint = fingerprint
      || (isConcretePhoneModel(effectiveModel) ? `xbf2.model.${effectiveModel}` : '')
    const revoked = await revokeSiblingPhoneDevices({
      fingerprint: effectiveFingerprint,
      model: effectiveModel,
      account,
      keepDeviceId: deviceId,
    })
    const meta = await upsertDeviceMeta(deviceId, {
      model: effectiveModel,
      fingerprint: effectiveFingerprint,
      account,
      userAgent,
    })
    // Keep durable dsh-mobile label as the model (not the enterprise username).
    try {
      await rewriteDevicesFile(effectiveModel, deviceId)
      await applyLabelToControllers(effectiveModel, deviceId)
    } catch {
      // display still works from meta even if label rewrite fails
    }
    setPhonePresence(deviceId, true)
    writeJson(response, 200, {
      ok: true,
      deviceId,
      model: effectiveModel,
      shortId: shortDeviceId(deviceId),
      account,
      revoked,
      display: formatDeviceDisplay({
        model: meta?.model || effectiveModel,
        shortId: shortDeviceId(deviceId),
        account,
        id: deviceId,
      }),
    }, request, true)
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : 'register_failed',
    }, request, true)
  }
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
  function modelFromUa(ua) {
    const s = String(ua || '')
    const fromBuild = s.match(/;\\s*([^;)]+?)\\s+Build\\//i)
    if (fromBuild && fromBuild[1]) {
      const name = fromBuild[1].trim().replace(/\\s+/g, ' ')
      if (name && name.length <= 32 && !/^wv$/i.test(name)) return name.slice(0, 32)
    }
    const fromAndroid = s.match(/Android\\s+[\\d.]+;\\s*([^;)]+?)(?:\\s+Build\\/|[;)])/i)
    if (fromAndroid && fromAndroid[1]) {
      const name = fromAndroid[1].trim().replace(/\\s+/g, ' ')
      if (name && name.length <= 32 && !/^wv$/i.test(name) && !/^(U|zh-cn|zh-tw|en-us)$/i.test(name)) {
        return name.slice(0, 32)
      }
    }
    if (/iPhone/i.test(s)) return 'iPhone'
    if (/iPad/i.test(s)) return 'iPad'
    if (/Android/i.test(s)) return 'Android'
    if (/HarmonyOS|HUAWEI/i.test(s)) return '华为'
    if (/Mobile|phone/i.test(s)) return '手机'
    if (/Macintosh|Mac OS/i.test(s)) return 'Mac'
    if (/Windows/i.test(s)) return 'Windows'
    return '浏览器'
  }
  function isConcreteModel(model) {
    const coarse = {
      iPhone:1, iPad:1, Android:1, '手机':1, '浏览器':1, Mac:1, Windows:1,
      'Windows Phone':1, '华为':1, 'Mobile device':1, 'DeepSeek Harness Android':1,
    }
    const m = String(model || '').trim()
    return m.length >= 3 && m.length <= 32 && !coarse[m]
  }
  // Same algorithm as client-src/shared.js — concrete Android model is the fingerprint.
  async function crossBrowserDeviceFingerprint() {
    const ua = String(navigator.userAgent || '')
    const model = modelFromUa(ua)
    if (isConcreteModel(model)) return 'xbf2.model.' + model
    const family = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : (/Android/i.test(ua) ? 'android' : 'other')
    let tz = ''
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { /* ignore */ }
    const w = screen.width || 0
    const h = screen.height || 0
    const shortSide = Math.min(w, h)
    const longSide = Math.max(w, h)
    const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100
    const parts = ['v2', family, model, shortSide + 'x' + longSide, String(dpr), String(navigator.maxTouchPoints || 0), tz]
    const raw = parts.join('|')
    try {
      if (crypto && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
        const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
        return 'xbf2.' + hex
      }
    } catch { /* fall through */ }
    let hash = 2166136261
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return 'xbf2.fb' + (hash >>> 0).toString(16).padStart(8, '0')
  }
  async function pair(code) {
    if (submitting) return
    submitting = true
    status.textContent = '正在连接…'
    const model = modelFromUa(navigator.userAgent)
    let fingerprint = ''
    try { fingerprint = await crossBrowserDeviceFingerprint() } catch { /* optional */ }
    try {
      const response = await fetch('/mobile-access/auth/pair', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        // Label is the device model; Host no longer overwrites it with the enterprise username.
        body: JSON.stringify({ token: code, label: model }),
      })
      if (!response.ok) {
        fail(response.status === 401 || response.status === 403
          ? '二维码已使用或已过期。换浏览器请先在电脑端点「刷新二维码」，再扫新码'
          : response.status === 429 ? '尝试过多，请稍后再试'
          : response.status === 409 ? '设备数量已满，请在电脑端清理后再试'
          : '连接失败，请重新扫码')
        return
      }
      try {
        await fetch('/api/t4y-mobile-cowatch/register-device', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fingerprint, model }),
          signal: timeoutSignal(4000),
        })
      } catch { /* non-blocking; WaitGate may retry */ }
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
      try { sessionStorage.removeItem('t4y.mobile.bootReload.v1') } catch { /* ignore */ }
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

/** @type {Array<(html: string) => string>} */
const bootHtmlInjectors = []
/** @type {typeof Buffer.from | null} */
let bootBufferFromOriginal = null

const BOOT_RECOVERY_SCRIPT = `<script data-t4y-boot-recovery="1">(function(){try{var k='t4y.mobile.bootReload.v1';var attempts=Number(sessionStorage.getItem(k)||'0');if(!Number.isFinite(attempts)||attempts<0)attempts=0;var n=0;var t=setInterval(function(){n++;var ok=!!document.querySelector('textarea,[contenteditable="true"]');if(ok){clearInterval(t);try{sessionStorage.removeItem(k)}catch(e){}return}var text=(document.body&&document.body.innerText)||'';if(attempts<2&&/Failed to load plugins/i.test(text)){sessionStorage.setItem(k,String(attempts+1));clearInterval(t);location.reload();return}if(n>75)clearInterval(t)},400)}catch(e){}})();<\/script>`

/**
 * Install a single process-wide Buffer.from wrapper that applies stacked HTML injectors.
 * Concurrent proxyMobileIndex calls push/pop injectors; they never replace each other's Buffer.from.
 */
function ensureBootBufferFromWrapper() {
  if (bootBufferFromOriginal) return
  bootBufferFromOriginal = Buffer.from.bind(Buffer)
  Buffer.from = function t4yBootBufferFrom(data, ...rest) {
    if (typeof data === 'string' && bootHtmlInjectors.length > 0) {
      let html = data
      for (let i = bootHtmlInjectors.length - 1; i >= 0; i -= 1) {
        html = bootHtmlInjectors[i](html)
      }
      return bootBufferFromOriginal(html, ...rest)
    }
    return bootBufferFromOriginal(data, ...rest)
  }
}

function restoreBootBufferFromWrapper() {
  if (!bootBufferFromOriginal) return
  Buffer.from = bootBufferFromOriginal
  bootBufferFromOriginal = null
  bootHtmlInjectors.length = 0
}

/**
 * @param {(html: string) => string} injector
 * @returns {() => void}
 */
function pushBootHtmlInjector(injector) {
  ensureBootBufferFromWrapper()
  bootHtmlInjectors.push(injector)
  return () => {
    const index = bootHtmlInjectors.lastIndexOf(injector)
    if (index >= 0) bootHtmlInjectors.splice(index, 1)
  }
}

/**
 * @param {string} html
 * @returns {string}
 */
function injectBootRecoveryHtml(html) {
  if (
    !html.includes('dsh-mobile-gateway')
    || !html.includes('<html')
    || html.includes('data-t4y-boot-recovery')
  ) {
    return html
  }
  return html.replace(
    '<meta name="dsh-mobile-gateway"',
    `${BOOT_RECOVERY_SCRIPT}<meta name="dsh-mobile-gateway"`,
  )
}

/** @type {WeakMap<object, Record<string, Function>>} */
const patchedPrototypeOriginals = new WeakMap()

/**
 * @param {Function} ctor
 * @param {string} methodName
 * @param {Function} replacement
 */
function patchPrototypeMethod(ctor, methodName, replacement) {
  const original = ctor.prototype[methodName]
  if (typeof original !== 'function') return
  let bag = patchedPrototypeOriginals.get(ctor)
  if (!bag) {
    bag = Object.create(null)
    patchedPrototypeOriginals.set(ctor, bag)
  }
  if (bag[methodName]) return
  bag[methodName] = original
  ctor.prototype[methodName] = replacement
}

/**
 * @param {Function} ctor
 */
function restorePatchedPrototype(ctor) {
  const bag = patchedPrototypeOriginals.get(ctor)
  if (!bag) return
  for (const [methodName, original] of Object.entries(bag)) {
    ctor.prototype[methodName] = original
  }
  patchedPrototypeOriginals.delete(ctor)
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
      patchPrototypeMethod(AccessController, methodName, function trackedMethod(...args) {
        track(this)
        return original.apply(this, args)
      })
    }

    const originalPair = AccessController.prototype.pair
    patchPrototypeMethod(AccessController, 'pair', async function pair(sourceKey, token, label) {
      track(this)
      // Keep the phone-supplied model label (or「手机」). Never replace with enterprise username.
      let nextLabel = label
      if (nextLabel === undefined || (typeof nextLabel === 'string' && nextLabel.trim() === '')) {
        nextLabel = '手机'
      }
      const result = await originalPair.call(this, sourceKey, token, nextLabel)
      try {
        const deviceId = typeof result?.deviceId === 'string' ? result.deviceId : null
        if (deviceId) {
          const account = await readHostDisplayName()
          await upsertDeviceMeta(deviceId, {
            model: typeof nextLabel === 'string' ? nextLabel : '手机',
            account: account || '',
          })
          setPhonePresence(deviceId, true)
        }
      } catch {
        // pairing already succeeded; meta is best-effort
      }
      return result
    })

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
      patchPrototypeMethod(Gateway, 'start', async function t4yTunedStart(...args) {
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
      })
    }
    const originalHandle = Gateway.prototype.handleExternalRequest
    if (typeof originalHandle === 'function') {
      patchPrototypeMethod(Gateway, 'handleExternalRequest', async function handleExternalRequest(request, response) {
        if (!mobileGateways.has(this)) {
          mobileGateways.add(this)
          tuneGatewayInstance(this)
        }
        // Any authenticated phone request counts as「已连接」— no client heartbeat.
        noteDeviceActivityFromNodeRequest(request)
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
      })
    }

    // Cold FRP boots can throw「Failed to load plugins」before cowatch client.js exists.
    // Inject a one-shot reload into the rewritten mobile index HTML (stack-safe).
    const originalProxyMobileIndex = Gateway.prototype.proxyMobileIndex
    if (typeof originalProxyMobileIndex === 'function') {
      patchPrototypeMethod(Gateway, 'proxyMobileIndex', async function t4yProxyMobileIndex(
        request,
        response,
        authorization,
        stockFrontend = false,
      ) {
        if (stockFrontend === true) {
          return originalProxyMobileIndex.call(this, request, response, authorization, stockFrontend)
        }
        let injected = false
        const pop = pushBootHtmlInjector((html) => {
          if (injected) return html
          const next = injectBootRecoveryHtml(html)
          if (next !== html) injected = true
          return next
        })
        try {
          return await originalProxyMobileIndex.call(this, request, response, authorization, stockFrontend)
        } finally {
          pop()
        }
      })
    }

    // Serial + extra retries: stock parallel upstream fan-out hits ECONNRESET and
    // the phone paints "Failed to load plugins" for the whole boot graph.
    const originalRetry = Gateway.prototype.readUpstreamClientBundleWithRetry
    if (typeof originalRetry === 'function') {
      patchPrototypeMethod(Gateway, 'readUpstreamClientBundleWithRetry', async function t4yRetryUpstream(source, signal) {
        let lastError
        for (let round = 1; round <= 5; round += 1) {
          try {
            return await originalRetry.call(this, source, signal)
          } catch (error) {
            lastError = error
            if (signal?.aborted) throw error
            await new Promise((resolve) => setTimeout(resolve, 400 * round))
          }
        }
        throw lastError
      })
    }
    const originalAssemble = Gateway.prototype.assembleMobileBootBatch
    if (typeof originalAssemble === 'function') {
      patchPrototypeMethod(Gateway, 'assembleMobileBootBatch', async function t4ySerialAssemble(plan, signal) {
        const bodies = new Array(plan.entries.length)
        // Strictly serial + short gap: stock's 3-wide pool and back-to-back loopback
        // GETs both trip ECONNRESET on the Host under FRP phone boot.
        for (let index = 0; index < plan.entries.length; index += 1) {
          if (index > 0) {
            await new Promise((resolve) => setTimeout(resolve, 80))
          }
          const entry = plan.entries[index]
          if (entry.id === MOBILE_LAYOUT_MODULE_ID) {
            bodies[index] = await readFile(this.config.mobileLayoutFile, { signal })
          } else {
            bodies[index] = await this.readUpstreamClientBundleWithRetry(entry.url, signal)
          }
          if (bodies[index].byteLength > MAX_MOBILE_BOOT_ENTRY_BYTES) {
            const err = new Error('upstream_unavailable')
            err.statusCode = 502
            throw err
          }
        }
        return Buffer.concat(bodies.flatMap((body) => [body, MOBILE_BOOT_SEPARATOR]))
      })
    }
  }
}

/**
 * Undo AccessController / Gateway prototype patches and the Buffer.from boot wrapper.
 * @param {any} [mod]
 */
function uninstallDshMobilePatches(mod) {
  restoreBootBufferFromWrapper()
  const AccessController = mod?.AccessController
  const Gateway = mod?.MobileAccessGateway
  if (typeof AccessController === 'function') {
    restorePatchedPrototype(AccessController)
    delete AccessController.__t4yEnterpriseLabelHooked
    delete AccessController.prototype.applyEnterpriseDeviceLabel
  }
  if (typeof Gateway === 'function') {
    restorePatchedPrototype(Gateway)
    delete Gateway.__t4yEnterprisePairHooked
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
        noteDeviceActivityFromNodeRequest(req)
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

/** @type {Set<object>} */
const patchedDshMobileModules = new Set()

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
      patchedDshMobileModules.add(mod)
    } catch {
      // skip unresolved copies
    }
  }
  try {
    const mod = await import('dsh-mobile')
    patchDshMobileModule(mod)
    patchedDshMobileModules.add(mod)
  } catch {
    // dsh-mobile may be absent on profiles that only use LAN / lab overlays.
  }
}

function uninstallAllDshMobilePatches() {
  for (const mod of patchedDshMobileModules) {
    uninstallDshMobilePatches(mod)
  }
  patchedDshMobileModules.clear()
  restoreBootBufferFromWrapper()
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
 * Live phone presence for「已连接」hint.
 * Pairing `lastSeenAt` stays for hours after the tab closes; only heartbeats mean the page is open.
 * @type {Map<string, {
 *   id: string,
 *   label: string,
 *   model: string,
 *   shortId: string,
 *   account: string,
 *   nativeInstanceId: string,
 *   at: number,
 * }>}
 */
const phonePresence = new Map()
/** Fallback if the tab dies without a leave beacon (crash / force-kill). */
const PRESENCE_TTL_MS = 5 * 60_000

/**
 * True when dsh-mobile still has a live (non-revoked, non-expired) durable device.
 * Revoked cookies must not keep「已连接」alive.
 * @param {string} deviceId
 * @returns {{ rawLabel: string, nativeInstanceId: string } | null}
 */
function findActivePairedDevice(deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-f\d]{32}$/u.test(deviceId)) return null
  const now = Date.now()
  for (const controller of [...accessControllers]) {
    if (typeof controller.listDevices !== 'function') continue
    try {
      const devices = controller.listDevices()
      if (!Array.isArray(devices)) continue
      for (const device of devices) {
        if (!device || typeof device !== 'object') continue
        const row = /** @type {Record<string, unknown>} */ (device)
        if (row.id !== deviceId) continue
        if (row.revokedAt !== undefined && row.revokedAt !== null) continue
        const expiresAt = typeof row.expiresAt === 'number' ? row.expiresAt : null
        if (expiresAt !== null && expiresAt <= now) continue
        const rawLabel = typeof row.label === 'string' && row.label.trim() !== '' ? row.label.trim() : ''
        const nativeInstanceId = typeof row.nativeInstanceId === 'string' && row.nativeInstanceId !== ''
          ? row.nativeInstanceId
          : deviceId
        return { rawLabel, nativeInstanceId }
      }
    } catch {
      // try next controller
    }
  }
  // Controllers not tracked yet — fall back to durable devices.json.
  if (accessControllers.size === 0) {
    try {
      const parsed = JSON.parse(readFileSync(devicesPath(), 'utf8'))
      if (parsed && Array.isArray(parsed.devices)) {
        for (const device of parsed.devices) {
          if (!device || device.id !== deviceId) continue
          if (device.revokedAt !== undefined && device.revokedAt !== null) continue
          if (typeof device.expiresAt === 'number' && device.expiresAt <= now) continue
          const rawLabel = typeof device.label === 'string' ? device.label.trim() : ''
          const nativeInstanceId = typeof device.nativeInstanceId === 'string' && device.nativeInstanceId !== ''
            ? device.nativeInstanceId
            : deviceId
          return { rawLabel, nativeInstanceId }
        }
      }
    } catch {
      // missing / invalid
    }
  }
  return null
}

/**
 * @param {string} deviceId
 * @returns {{
 *   id: string,
 *   label: string,
 *   model: string,
 *   shortId: string,
 *   account: string,
 *   nativeInstanceId: string,
 * } | null}
 */
function resolvePresenceDevice(deviceId) {
  const active = findActivePairedDevice(deviceId)
  if (!active) return null
  const stored = loadDeviceMetaSync().byDeviceId[deviceId]
  const storedRow = stored && typeof stored === 'object'
    ? /** @type {Record<string, unknown>} */ (stored)
    : null
  const rawLabel = active.rawLabel
  const nativeInstanceId = active.nativeInstanceId
  const KNOWN_MODELS = new Set([
    'iPhone', 'iPad', 'Android', '华为', '手机', '浏览器', 'Mac', 'Windows', 'Windows Phone',
    'Mobile device', 'DeepSeek Harness Android',
  ])
  let model = typeof storedRow?.model === 'string' && storedRow.model.trim() !== ''
    ? storedRow.model.trim()
    : ''
  let account = typeof storedRow?.account === 'string' ? storedRow.account.trim() : ''
  if (model === '') {
    if (rawLabel !== '' && KNOWN_MODELS.has(rawLabel)) {
      model = GENERIC_LABELS.has(rawLabel) ? '手机' : rawLabel
    } else if (rawLabel !== '' && !GENERIC_LABELS.has(rawLabel)) {
      // Legacy rows stored enterprise displayName as the durable label.
      model = isConcretePhoneModel(rawLabel) ? rawLabel : '手机'
      if (account === '' && !isConcretePhoneModel(rawLabel)) account = rawLabel
    } else {
      model = '手机'
    }
  }
  const shortId = typeof storedRow?.shortId === 'string' && storedRow.shortId !== ''
    ? storedRow.shortId
    : shortDeviceId(deviceId)
  const label = formatDeviceDisplay({ model, shortId, account, id: deviceId, label: rawLabel })
  return { id: deviceId, label, model, shortId, account, nativeInstanceId }
}

/**
 * @param {string} deviceId
 * @param {boolean} online
 * @returns {boolean} whether the device is treated as online
 */
function setPhonePresence(deviceId, online) {
  if (!online) {
    phonePresence.delete(deviceId)
    phoneLeftAt.set(deviceId, Date.now())
    return false
  }
  phoneLeftAt.delete(deviceId)
  const meta = resolvePresenceDevice(deviceId)
  if (!meta) {
    // Cookie left after revoke / expiry — drop ghost「已连接」.
    phonePresence.delete(deviceId)
    return false
  }
  phonePresence.set(deviceId, { ...meta, at: Date.now() })
  return true
}

/**
 * Phones with a fresh heartbeat on this Host (page still open).
 * @returns {{
 *   devices: {
 *     id: string,
 *     label: string,
 *     model: string,
 *     shortId: string,
 *     account: string,
 *     nativeInstanceId: string,
 *     lastSeenAt: number,
 *     online: boolean,
 *     expiresAt: null,
 *   }[],
 *   onlineCount: number,
 * }}
 */
function listConnectedDevices() {
  const now = Date.now()
  /** @type {Map<string, {
   *   id: string,
   *   label: string,
   *   model: string,
   *   shortId: string,
   *   account: string,
   *   nativeInstanceId: string,
   *   lastSeenAt: number,
   *   online: boolean,
   *   expiresAt: null,
   * }>} */
  const byKey = new Map()
  for (const [deviceId, row] of [...phonePresence]) {
    if (now - row.at > PRESENCE_TTL_MS) {
      phonePresence.delete(deviceId)
      continue
    }
    const fresh = resolvePresenceDevice(deviceId)
    if (!fresh) {
      phonePresence.delete(deviceId)
      continue
    }
    // One live row per concrete handset model (VER-AN10), else per native instance.
    const dedupeKey = isConcretePhoneModel(fresh.model)
      ? `model:${fresh.model}`
      : `id:${fresh.nativeInstanceId}`
    const prev = byKey.get(dedupeKey)
    if (!prev || row.at > prev.lastSeenAt) {
      byKey.set(dedupeKey, {
        id: fresh.id,
        label: fresh.label,
        model: fresh.model,
        shortId: fresh.shortId,
        account: fresh.account,
        nativeInstanceId: fresh.nativeInstanceId,
        lastSeenAt: row.at,
        online: true,
        expiresAt: null,
      })
    }
  }
  const devices = [...byKey.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  return { devices, onlineCount: devices.length }
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
  // Unique FRP Host per Desktop (shared frps); no-op when base domain / id missing.
  void ensurePerHostPublicOrigin().catch(() => { /* boot must not fail on FRP rewrite */ })
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
    uninstallAllDshMobilePatches()
  }, 't4y-mobile-enter: clear handler + server intercept + dsh-mobile patches')

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

  // Claim the shared accepting slot on boot when this Host is accepting.
  if (isAccepting()) {
    void setAccepting(true, { heartbeatOnly: true }).catch(() => {
      // Another Host won the race — soft-off locally so we do not dual-pull frpc.
      acceptingEngagements = false
    })
  }

  // Keep public FRP while accepting, and through soft-off grace for「电脑不在线」.
  // When guard asks for reconnect (frpc_missing / cleared), Host starts official FrpController
  // itself — Client auto-ensure alone is too slow / may be on a background tab.
  ctx.effect(() => {
    let busy = false
    const run = () => {
      if (busy) return
      busy = true
      const heartbeat = isAccepting()
        ? setAccepting(true, { heartbeatOnly: true }).catch((error) => {
          if (error instanceof AcceptingSlotBusyError) acceptingEngagements = false
        })
        : Promise.resolve()
      void heartbeat
        .then(() => ensureFrpRuntimeGuard({ accepting: shouldKeepFrpAlive() }))
        .then(async (guard) => {
          if (!guard?.needReconnect || !isAccepting()) return
          const base = hostLoopbackBase(ctx)
          const headers = {
            'content-type': 'application/json',
            'x-dsh-mobile-web-admin': 'same-origin-json',
          }
          try {
            await fetch(`${base}/api/mobile-access/remote/control`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ running: true, provider: 'frp' }),
            })
          } catch { /* reconnect below */ }
          try {
            await fetch(`${base}/api/mobile-access/remote/reconnect`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ provider: 'frp' }),
            })
          } catch { /* next tick */ }
        })
        .catch(() => { /* next tick */ })
        .finally(() => { busy = false })
    }
    run()
    const timer = setInterval(run, 8_000)
    return () => clearInterval(timer)
  }, 't4y-mobile-cowatch: frp runtime guard')

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

  // Rewrite FRP publicOrigin to this installation's subdomain; Desktop may re-configure frpc.
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/per-host-origin',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const result = await ensurePerHostPublicOrigin()
        return json(200, result)
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'per_host_origin_failed',
        })
      }
    },
  })

  // Phone page heartbeat — paired cookie required. Desktop「已连接」reads this, not pair lastSeenAt.
  // Prefer the public Gateway intercept (no CSRF); this Host route stays for loopback/dev.
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/presence',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const deviceId = deviceIdFromRequest(request)
        if (!deviceId) return json(401, { error: 'device_required' })
        let online = true
        try {
          const body = await request.json()
          if (body && typeof body.online === 'boolean') online = body.online
        } catch {
          // empty / keepalive leave body → treat as online beat when POST without JSON
        }
        await nudgeTrackControllers(ctx)
        const accepted = setPhonePresence(deviceId, online)
        if (online && !accepted) return json(401, { error: 'device_revoked' })
        return json(200, { ok: true, online: accepted && online, deviceId })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'presence_failed',
        })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/register-device',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const deviceId = deviceIdFromRequest(request)
        if (!deviceId || !/^[a-f\d]{32}$/u.test(deviceId)) {
          return json(401, { error: 'device_required' })
        }
        let body = {}
        try {
          body = await request.json()
        } catch {
          body = {}
        }
        const userAgent = request.headers.get('user-agent') || ''
        const modelRaw = typeof body?.model === 'string' ? body.model.trim().slice(0, 32) : ''
        const model = modelRaw !== '' ? modelRaw : modelFromUserAgent(userAgent)
        const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint.trim().slice(0, 96) : ''
        const accountRaw = typeof body?.account === 'string' ? body.account.trim().slice(0, 64) : ''
        const account = accountRaw !== '' ? accountRaw : (await readHostDisplayName() || '')
        await nudgeTrackControllers(ctx)
        const uaModel = modelFromUserAgent(userAgent)
        const effectiveModel = isConcretePhoneModel(model)
          ? model
          : (isConcretePhoneModel(uaModel) ? uaModel : model)
        const effectiveFingerprint = fingerprint
          || (isConcretePhoneModel(effectiveModel) ? `xbf2.model.${effectiveModel}` : '')
        const revoked = await revokeSiblingPhoneDevices({
          fingerprint: effectiveFingerprint,
          model: effectiveModel,
          account,
          keepDeviceId: deviceId,
        })
        const meta = await upsertDeviceMeta(deviceId, {
          model: effectiveModel,
          fingerprint: effectiveFingerprint,
          account,
          userAgent,
        })
        try {
          await rewriteDevicesFile(effectiveModel, deviceId)
          await applyLabelToControllers(effectiveModel, deviceId)
        } catch {
          // meta is enough for「已连接」
        }
        setPhonePresence(deviceId, true)
        return json(200, {
          ok: true,
          deviceId,
          model: effectiveModel,
          shortId: shortDeviceId(deviceId),
          account,
          revoked,
          display: formatDeviceDisplay({
            model: meta?.model || effectiveModel,
            shortId: shortDeviceId(deviceId),
            account,
            id: deviceId,
          }),
        })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'register_failed',
        })
      }
    },
  })

  // Clear orphan frpc / report whether FrpController must reconnect (pairing needs gateway()).
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/frp-guard',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        let clearForReconnect = false
        if (request.method === 'POST') {
          try {
            const raw = await request.text()
            if (raw && raw !== '{}') {
              const body = JSON.parse(raw)
              clearForReconnect = body?.clearForReconnect === true
            }
          } catch {
            clearForReconnect = false
          }
        }
        const result = await ensureFrpRuntimeGuard({
          accepting: shouldKeepFrpAlive(),
          clearForReconnect,
        })
        return json(200, {
          ...result,
          acceptingEngaged: isAccepting(),
          frpReleaseAt: frpReleaseAtMs,
        })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'frp_guard_failed',
        })
      }
    },
  })

  // Soft-off switch for desktop menu (cookie-authed Host). Phone polls the public status route.
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/connected-devices',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        await nudgeTrackControllers(ctx)
        return json(200, listConnectedDevices())
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'connected_devices_failed',
        })
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/accepting',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request.method === 'GET') {
          return json(200, {
            accepting: isAccepting(),
            holderKind: ACCEPTING_HOLDER_KIND,
            holderId: ACCEPTING_INSTANCE_ID,
          })
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
        if (error instanceof AcceptingSlotBusyError) {
          return json(409, {
            error: 'accepting_slot_busy',
            message: error.holderKind === 'desktop'
              ? '请在 Desktop 端开启移动访问（当前槽位已被 Desktop 占用）'
              : '另一端已开启移动访问，请先在那一端关闭后再试',
            holderKind: error.holderKind,
          })
        }
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
        if (!preferredDeviceId) return json(400, { error: 'device_required' })

        // Account only — never overwrite the durable device label with the username.
        const meta = await upsertDeviceMeta(preferredDeviceId, { account: displayName })
        setPhonePresence(preferredDeviceId, true)
        return json(200, {
          updated: true,
          displayName,
          deviceId: preferredDeviceId,
          display: formatDeviceDisplay({
            model: typeof meta?.model === 'string' ? meta.model : '手机',
            shortId: shortDeviceId(preferredDeviceId),
            account: displayName,
            id: preferredDeviceId,
          }),
        })
      } catch (error) {
        return json(500, {
          error: error instanceof Error ? error.message : 'bind_failed',
        })
      }
    },
  })
}

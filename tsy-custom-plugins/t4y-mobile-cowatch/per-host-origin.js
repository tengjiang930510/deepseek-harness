/**
 * Per-Desktop FRP public Origin: unique Host header so many PCs can share one frps.
 * Requires VPS Caddy/DNS to accept `*.{publicBaseDomain}` (see ops/frp-multi-host-caddy.md).
 *
 * Base domain lives in `t4y-frp.json` / env — never in dsh-mobile `settings.json`
 * (unknown keys make parseFrpSettings throw).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

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
function settingsPath() {
  return join(dshHome(), 'mobile-access', 'remote', 'frp', 'config', 'settings.json')
}

/**
 * @returns {string}
 */
function baseDomainPath() {
  return join(dshHome(), 'mobile-access', 't4y-frp.json')
}

/**
 * @returns {string}
 */
function installationIdPath() {
  return join(dshHome(), 'mobile-access', 'installation-id')
}

/**
 * @param {string} serverAddress
 * @returns {string | null}
 */
export function sslipBaseFromAddress(serverAddress) {
  const trimmed = String(serverAddress || '').trim()
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(trimmed)) return null
  return `${trimmed.replaceAll('.', '-')}.sslip.io`
}

/**
 * @param {string} installationId
 * @returns {string}
 */
export function hostLabelFromInstallationId(installationId) {
  const hex = String(installationId).trim().toLowerCase()
  if (!/^[a-f\d]{12,}$/u.test(hex)) throw new Error('installation_id_invalid')
  return `dsh-${hex.slice(0, 12)}`
}

/**
 * @returns {Promise<string | null>}
 */
async function readStoredBaseDomain() {
  const envBase = typeof process.env.T4Y_FRP_PUBLIC_BASE_DOMAIN === 'string'
    ? process.env.T4Y_FRP_PUBLIC_BASE_DOMAIN.trim().replace(/^https?:\/\//u, '').replace(/\/$/u, '')
    : ''
  if (envBase) return envBase
  try {
    const parsed = JSON.parse(await readFile(baseDomainPath(), 'utf8'))
    if (typeof parsed?.publicBaseDomain === 'string' && parsed.publicBaseDomain.trim() !== '') {
      return parsed.publicBaseDomain.trim().replace(/^https?:\/\//u, '').replace(/\/$/u, '')
    }
  } catch {
    // absent
  }
  return null
}

/**
 * Keys allowed by dsh-mobile `parseFrpSettings` / `FRP_SETTINGS_KEYS`.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function frpConfigureBody(settings) {
  /** @type {Record<string, unknown>} */
  const body = {
    version: 1,
    serverAddress: settings.serverAddress,
    serverPort: settings.serverPort,
    token: settings.token,
    publicOrigin: settings.publicOrigin,
  }
  if (settings.mode !== undefined) body.mode = settings.mode
  if (settings.entryTls !== undefined) body.entryTls = settings.entryTls
  if (settings.vhostHttpPort !== undefined) body.vhostHttpPort = settings.vhostHttpPort
  if (settings.publicPort !== undefined) body.publicPort = settings.publicPort
  return body
}

/**
 * Read/install FRP settings and rewrite `publicOrigin` to `https://{label}.{base}` when a base domain is known.
 * @returns {Promise<{ changed: boolean, publicOrigin: string | null, publicBaseDomain: string | null, configure?: Record<string, unknown>, reason?: string }>}
 */
export async function ensurePerHostPublicOrigin() {
  let installationId
  try {
    installationId = (await readFile(installationIdPath(), 'utf8')).trim()
  } catch {
    return { changed: false, publicOrigin: null, publicBaseDomain: null, reason: 'installation_id_missing' }
  }

  const file = settingsPath()
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { changed: false, publicOrigin: null, publicBaseDomain: null, reason: 'settings_missing' }
  }

  /** @type {Record<string, unknown>} */
  let settings
  try {
    settings = JSON.parse(raw)
  } catch {
    return { changed: false, publicOrigin: null, publicBaseDomain: null, reason: 'settings_invalid' }
  }
  if (!settings || typeof settings !== 'object') {
    return { changed: false, publicOrigin: null, publicBaseDomain: null, reason: 'settings_invalid' }
  }

  const serverAddress = typeof settings.serverAddress === 'string' ? settings.serverAddress : ''
  const base = (await readStoredBaseDomain()) || sslipBaseFromAddress(serverAddress)
  if (!base) {
    return {
      changed: false,
      publicOrigin: typeof settings.publicOrigin === 'string' ? settings.publicOrigin : null,
      publicBaseDomain: null,
      reason: 'base_domain_missing',
    }
  }

  let label
  try {
    label = hostLabelFromInstallationId(installationId)
  } catch {
    return { changed: false, publicOrigin: null, publicBaseDomain: base, reason: 'installation_id_invalid' }
  }

  const nextOrigin = `https://${label}.${base}`
  const prevOrigin = typeof settings.publicOrigin === 'string' ? settings.publicOrigin : ''
  if (prevOrigin === nextOrigin) {
    return {
      changed: false,
      publicOrigin: nextOrigin,
      publicBaseDomain: base,
      configure: frpConfigureBody(settings),
    }
  }

  const next = {
    version: 1,
    serverAddress: settings.serverAddress,
    serverPort: settings.serverPort,
    token: settings.token,
    publicOrigin: nextOrigin,
    ...(settings.mode !== undefined ? { mode: settings.mode } : {}),
    ...(settings.entryTls !== undefined ? { entryTls: settings.entryTls } : {}),
    ...(settings.vhostHttpPort !== undefined ? { vhostHttpPort: settings.vhostHttpPort } : {}),
    ...(settings.publicPort !== undefined ? { publicPort: settings.publicPort } : {}),
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 })
  return {
    changed: true,
    publicOrigin: nextOrigin,
    publicBaseDomain: base,
    configure: frpConfigureBody(next),
  }
}

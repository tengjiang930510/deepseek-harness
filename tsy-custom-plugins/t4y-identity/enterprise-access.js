/**
 * Shared Host enterprise gateway for all t4y-* / future intranet plugins (方案 B).
 *
 * Rule: browsers call same-origin `/api/t4y-enterprise/*`; the Host injects the
 * enterprise accessToken from host-session (or bootstrap `X-T4Y-Access-Token`).
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Hosts the gateway may reach (API + assets). */
export const ENTERPRISE_GATEWAY_HOSTS = Object.freeze([
  'eims.crfsdi.com.cn',
  'jgyw.crfsdi.com.cn',
])

const GATEWAY_HOST_SET = new Set(ENTERPRISE_GATEWAY_HOSTS)

/** Canonical asset proxy path (方案 B). */
export const ENTERPRISE_ASSET_PATH = '/api/t4y-enterprise/asset'
/** Canonical JSON/API proxy path (方案 B). */
export const ENTERPRISE_PROXY_PATH = '/api/t4y-enterprise/proxy'

/** @deprecated Prefer ENTERPRISE_GATEWAY_HOSTS */
export const ENTERPRISE_ASSET_HOSTS = ENTERPRISE_GATEWAY_HOSTS

/**
 * @returns {string}
 */
export function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  return join(homedir(), '.dsh')
}

/**
 * @returns {string}
 */
export function hostSessionPath() {
  return join(dshHome(), 't4y-identity', 'host-session.json')
}

/**
 * Desktop-shared enterprise accessToken (PC login → phone co-watch).
 * @returns {Promise<string | null>}
 */
export async function readHostAccessToken() {
  try {
    const raw = await readFile(hostSessionPath(), 'utf8')
    const parsed = JSON.parse(raw)
    const session = parsed?.session ?? parsed
    const token = session?.accessToken
    return typeof token === 'string' && token.trim() !== '' ? token.trim() : null
  } catch {
    return null
  }
}

/**
 * @param {Headers | Record<string, string | string[] | undefined>} headers
 * @param {string} name
 * @returns {string | null}
 */
function headerValue(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }
  const direct = headers[name] ?? headers[name.toLowerCase()]
  const value = Array.isArray(direct) ? direct[0] : direct
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Resolve enterprise token for a Host route.
 * 1) `X-T4Y-Access-Token` — Desktop login/re-login bootstrap
 * 2) host-session — Mobile and Host-only plugins (no enterprise header)
 * Never treat DSH web-session cookies as enterprise credentials.
 * @param {Request | { headers?: Headers | Record<string, string | string[] | undefined> } | null | undefined} request
 * @returns {Promise<string | null>}
 */
export async function resolveEnterpriseAccessToken(request) {
  if (request?.headers) {
    const fromT4y = headerValue(request.headers, 'x-t4y-access-token')
    if (fromT4y) return fromT4y
  }
  return readHostAccessToken()
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isAllowedEnterpriseGatewayHost(hostname) {
  return GATEWAY_HOST_SET.has(hostname)
}

/** @deprecated Prefer isAllowedEnterpriseGatewayHost */
export const isAllowedEnterpriseAssetHost = isAllowedEnterpriseGatewayHost

/**
 * @param {string} absoluteUrl
 * @returns {URL | null}
 */
export function parseAllowedEnterpriseUrl(absoluteUrl) {
  if (typeof absoluteUrl !== 'string' || absoluteUrl === '') return null
  let parsed
  try { parsed = new URL(absoluteUrl) } catch { return null }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (!isAllowedEnterpriseGatewayHost(parsed.hostname)) return null
  return parsed
}

/** @deprecated Prefer parseAllowedEnterpriseUrl */
export const parseAllowedEnterpriseAssetUrl = parseAllowedEnterpriseUrl

/**
 * Same-origin browser URL for an intranet asset.
 * @param {string} absoluteUrl
 * @returns {string | null}
 */
export function enterpriseAssetProxyPath(absoluteUrl) {
  const parsed = parseAllowedEnterpriseUrl(absoluteUrl)
  if (!parsed) return null
  return `${ENTERPRISE_ASSET_PATH}?url=${encodeURIComponent(parsed.toString())}`
}

/**
 * Resolve an outbound target for the generic JSON proxy.
 * Accepts absolute `url` (allowlisted host) or `path` relative to apiBaseUrl.
 * @param {{ url?: unknown, path?: unknown }} body
 * @param {string} apiBaseUrl
 * @returns {{ ok: true, target: URL } | { ok: false, error: string }}
 */
export function resolveEnterpriseProxyTarget(body, apiBaseUrl) {
  const absolute = typeof body?.url === 'string' ? body.url.trim() : ''
  if (absolute !== '') {
    const parsed = parseAllowedEnterpriseUrl(absolute)
    if (!parsed) return { ok: false, error: 'host_not_allowed' }
    return { ok: true, target: parsed }
  }
  const path = typeof body?.path === 'string' ? body.path.trim() : ''
  if (path === '') return { ok: false, error: 'invalid_target' }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('..')) {
    return { ok: false, error: 'invalid_path' }
  }
  if (path.length > 1024) return { ok: false, error: 'invalid_path' }
  const base = String(apiBaseUrl || '').replace(/\/$/, '')
  if (base === '') return { ok: false, error: 'api_base_missing' }
  // Do not use `new URL(path, base)` — an absolute path replaces the base pathname
  // (drops `/backendapi`). Concatenate, then validate the host allowlist.
  try {
    const target = new URL(`${base}${path}`)
    if (!isAllowedEnterpriseGatewayHost(target.hostname)) return { ok: false, error: 'host_not_allowed' }
    return { ok: true, target }
  } catch {
    return { ok: false, error: 'invalid_path' }
  }
}

/**
 * @param {string} url
 * @param {{
 *   accessToken: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<Response>}
 */
export function enterpriseFetch(url, options) {
  const accessToken = options?.accessToken
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    return Promise.reject(new Error('Authentication required'))
  }
  const method = options.method || (options.body === undefined ? 'GET' : 'POST')
  return fetch(url, {
    method,
    headers: {
      Authorization: accessToken.trim(),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    signal: options.signal,
  })
}

/**
 * Cordis service: token + allowlist + outbound helpers for Host plugins.
 * @param {{ apiBaseUrl: string }} config
 */
export function createEnterpriseAccess(config) {
  const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '')
  return {
    apiBaseUrl,
    assetHosts: ENTERPRISE_GATEWAY_HOSTS,
    gatewayHosts: ENTERPRISE_GATEWAY_HOSTS,
    assetPath: ENTERPRISE_ASSET_PATH,
    proxyPath: ENTERPRISE_PROXY_PATH,
    readHostAccessToken,
    resolveAccessToken: resolveEnterpriseAccessToken,
    /**
     * @param {Request | null | undefined} [request]
     * @returns {Promise<string>}
     */
    async requireAccessToken(request) {
      const token = await resolveEnterpriseAccessToken(request)
      if (!token) throw new Error('Authentication required')
      return token
    },
    isAllowedAssetHost: isAllowedEnterpriseGatewayHost,
    isAllowedGatewayHost: isAllowedEnterpriseGatewayHost,
    parseAllowedAssetUrl: parseAllowedEnterpriseUrl,
    parseAllowedUrl: parseAllowedEnterpriseUrl,
    assetProxyPath: enterpriseAssetProxyPath,
    resolveProxyTarget: (body) => resolveEnterpriseProxyTarget(body, apiBaseUrl),
    fetch: enterpriseFetch,
    /**
     * @param {string} path
     * @param {{
     *   accessToken: string,
     *   method?: string,
     *   headers?: Record<string, string>,
     *   body?: unknown,
     *   signal?: AbortSignal,
     * }} options
     */
    async apiFetch(path, options) {
      const suffix = path.startsWith('/') ? path : `/${path}`
      const body = options.body === undefined ? undefined : JSON.stringify(options.body)
      const response = await enterpriseFetch(`${apiBaseUrl}${suffix}`, {
        accessToken: options.accessToken,
        method: options.method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.headers || {}),
        },
        body,
        signal: options.signal,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      return { response, payload }
    },
  }
}

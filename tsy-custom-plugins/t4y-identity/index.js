/** Host half: enterprise identity config; bridges enterprise tokens to New API keys via Broker into credential slot `T4Y_NEW_API_KEY`. */
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createEnterpriseAccess,
  dshHome,
  ENTERPRISE_ASSET_PATH,
  ENTERPRISE_PROXY_PATH,
  hostSessionPath,
  parseAllowedEnterpriseUrl,
  resolveEnterpriseAccessToken,
  resolveEnterpriseProxyTarget,
} from './enterprise-access.js'

export const name = 't4y-identity'
export const inject = {
  t4yTenant: true,
  connection: true,
  credentials: true,
  settings: true,
  llm: { required: false },
  agentDefaultModel: { required: false },
  // Optional: when present, project-workspace keeps only the current project's
  // Workspace + Sessions visible (archive others, delete other Workspaces).
  workspaceRegistry: { required: false },
  sessionPersistence: { required: false },
  sessions: { required: false },
}

/**
 * @typedef {{
 *   apiBaseUrl?: string,
 *   brokerBaseUrl: string,
 *   newApiBaseUrl: string,
 *   defaultTenantId?: string,
 * }} IdentityConfig
 */

const DEFAULT_API_BASE_URL = 'https://jgyw.crfsdi.com.cn:51111/backendapi'
const MODEL_CREDENTIAL_REF = 'T4Y_NEW_API_KEY'
const LLM_SETTINGS_NAMESPACE = 'llm-pi-ai'
const LLM_PROVIDER = 't4y-newapi'

/**
 * Keep only fields Mobile needs to skip the login gate. Drop incomplete picks.
 * @param {unknown} raw
 * @returns {object | null}
 */
function sanitizeSharedSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const body = /** @type {Record<string, unknown>} */ (raw)
  if (typeof body.accessToken !== 'string' || body.accessToken.trim() === '') return null
  if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now()) return null
  if (body.needsModulePick === true) return null
  const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim() !== ''
    ? body.tenantId.trim()
    : (typeof body.enterpriseId === 'string' ? body.enterpriseId.trim() : '')
  if (tenantId === '' || tenantId.includes('/') || tenantId.includes('..')) return null
  const moduleId = typeof body.moduleId === 'string' ? body.moduleId.trim() : ''
  if (moduleId === '') return null
  const modules = Array.isArray(body.modules)
    ? body.modules.filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id !== '').slice(0, 64)
    : []
  return {
    accessToken: body.accessToken.trim(),
    expiresAt: body.expiresAt,
    username: typeof body.username === 'string' ? body.username : '',
    displayName: typeof body.displayName === 'string' ? body.displayName : '',
    tenantId,
    enterpriseName: typeof body.enterpriseName === 'string' ? body.enterpriseName : '',
    systemName: typeof body.systemName === 'string' ? body.systemName : '',
    logo: typeof body.logo === 'string' ? body.logo : '',
    roles: Array.isArray(body.roles) ? body.roles.filter((role) => typeof role === 'string').slice(0, 32) : [],
    moduleId,
    moduleName: typeof body.moduleName === 'string' ? body.moduleName : null,
    moduleLogo: typeof body.moduleLogo === 'string' ? body.moduleLogo : null,
    modules,
    loggedInAt: typeof body.loggedInAt === 'string' ? body.loggedInAt : new Date().toISOString(),
    needsModulePick: false,
    ...(typeof body.llmApiKeyExpiresAt === 'number' && Number.isFinite(body.llmApiKeyExpiresAt)
      ? { llmApiKeyExpiresAt: body.llmApiKeyExpiresAt }
      : {}),
    ...(typeof body.keyHomeModuleId === 'string' && body.keyHomeModuleId !== ''
      ? { keyHomeModuleId: body.keyHomeModuleId }
      : {}),
  }
}

/**
 * @returns {Promise<object | null>}
 */
async function readHostSessionFile() {
  try {
    const raw = await readFile(hostSessionPath(), 'utf8')
    const parsed = JSON.parse(raw)
    const session = sanitizeSharedSession(parsed?.session ?? parsed)
    if (!session) {
      try { await unlink(hostSessionPath()) } catch { /* missing/expired */ }
      return null
    }
    return session
  } catch {
    return null
  }
}

/**
 * @param {object | null} session
 * @returns {Promise<void>}
 */
async function writeHostSessionFile(session) {
  const path = hostSessionPath()
  if (session === null) {
    try { await unlink(path) } catch { /* already gone */ }
    return
  }
  await mkdir(join(dshHome(), 't4y-identity'), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 1, updatedAt: Date.now(), session }, null, 0)}\n`, 'utf8')
}

/**
 * One filesystem directory per enterprise project so Workspace sessions stay isolated.
 * @param {string} moduleId
 * @returns {string}
 */
function projectWorkspacePath(moduleId) {
  if (typeof moduleId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(moduleId)) {
    throw new Error('invalid_module_id')
  }
  return join(dshHome(), 't4y-projects', moduleId)
}

/**
 * Whether a session cwd belongs to the project's canonical Workspace path.
 * @param {string | undefined} cwd
 * @param {string} canonicalPath
 * @returns {Promise<boolean>}
 */
async function cwdMatchesProject(cwd, canonicalPath) {
  if (typeof cwd !== 'string' || cwd === '') return false
  if (cwd === canonicalPath) return true
  try {
    return (await realpath(cwd)) === canonicalPath
  } catch {
    return false
  }
}

/**
 * Collect every known session id + cwd from live sessions and persistence.
 * @param {*} ctx
 * @returns {Promise<Map<string, string | undefined>>}
 */
async function collectSessionCwds(ctx) {
  /** @type {Map<string, string | undefined>} */
  const byId = new Map()
  const live = ctx.sessions?.list?.()
  if (Array.isArray(live)) {
    for (const session of live) {
      const id = session?.id ?? session?.header?.id
      if (typeof id !== 'string' || id === '') continue
      byId.set(id, session?.header?.cwd)
    }
  }
  if (ctx.sessionPersistence?.list) {
    try {
      const snapshots = await ctx.sessionPersistence.list()
      if (Array.isArray(snapshots)) {
        for (const snapshot of snapshots) {
          const id = snapshot?.header?.id
          if (typeof id !== 'string' || id === '') continue
          if (!byId.has(id)) byId.set(id, snapshot.header.cwd)
        }
      }
    } catch {
      // Persistence listing is best-effort; live + Workspace accounts still prune.
    }
  }
  return byId
}

/**
 * Make the sidebar show only this project's Workspace and its Sessions:
 * archive foreign Sessions, delete other Workspaces, then restore + attach
 * Sessions whose cwd matches this project (so switching back recovers them).
 * @param {*} ctx
 * @param {{ path: string, title?: string }} request
 * @returns {Promise<{ path: string, workspaceId: string | null }>}
 */
async function soloProjectWorkspace(ctx, request) {
  const registry = ctx.workspaceRegistry
  if (!registry?.create) {
    return { path: request.path, workspaceId: null }
  }

  const workspace = typeof request.title === 'string' && request.title !== ''
    ? await registry.create(request.path, request.title)
    : await registry.create(request.path)
  const canonicalPath = workspace.path
  const keepId = workspace.id
  const keepSessions = new Set(workspace.sessionIds.map(String))

  const cwds = await collectSessionCwds(ctx)
  const isArchived = (sessionId) => {
    const archived = registry.archivedSessionIds
    return Array.isArray(archived) && archived.some(id => String(id) === String(sessionId))
  }

  for (const other of registry.list()) {
    if (other.id === keepId) continue
    for (const sessionId of other.sessionIds) {
      try {
        await registry.archiveSession(sessionId, { stopActivity: true })
      } catch {
        // Already archived / unknown — still remove the Workspace below.
      }
    }
    try {
      await registry.delete(other.id)
    } catch {
      // Idempotent: a concurrent Client delete is fine.
    }
  }

  // Ungrouped / leftover Sessions: keep only those that belong to this path.
  for (const [sessionId, cwd] of cwds) {
    if (keepSessions.has(sessionId)) continue
    if (await cwdMatchesProject(cwd, canonicalPath)) {
      try {
        if (isArchived(sessionId)) await registry.unarchiveSession(sessionId)
        await workspace.attachSession(sessionId)
        keepSessions.add(sessionId)
      } catch {
        // Attach validates cwd; skip irreparable rows.
      }
      continue
    }
    if (isArchived(sessionId)) continue
    try {
      await registry.archiveSession(sessionId, { stopActivity: true })
    } catch {
      // Best-effort hide.
    }
  }

  // Previously archived Sessions from this same project directory (Workspace
  // was deleted on an earlier switch) — bring them back under the new account.
  for (const sessionId of [...(registry.archivedSessionIds ?? [])]) {
    if (keepSessions.has(String(sessionId))) continue
    const cwd = cwds.get(String(sessionId))
    if (!(await cwdMatchesProject(cwd, canonicalPath))) continue
    try {
      await registry.unarchiveSession(sessionId)
      await workspace.attachSession(sessionId)
      keepSessions.add(String(sessionId))
    } catch {
      // Leave archived if attach cannot validate.
    }
  }

  if (typeof request.title === 'string' && request.title !== '' && workspace.title !== request.title) {
    try {
      await workspace.setTitle(request.title)
    } catch {
      // Title is cosmetic.
    }
  }

  return { path: canonicalPath, workspaceId: String(keepId) }
}

/** Friendly labels for the models this deployment currently exposes. */
const MODEL_DISPLAY_NAMES = Object.freeze({
  'qwen3.8-flash': 'Qwen 3.8 Flash',
  'qwen3.8-max': 'Qwen 3.8 Max',
})

/** @param {unknown} value @param {string} field */
function requiredHttpUrl(value, field) {
  if (typeof value !== 'string' || value === '') throw new Error(`t4y-identity: ${field} must be configured`)
  let url
  try { url = new URL(value) } catch { throw new Error(`t4y-identity: ${field} must be an HTTP(S) URL`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`t4y-identity: ${field} must be an HTTP(S) URL`)
  }
  return url.toString().replace(/\/$/, '')
}

/** @param {number} status @param {object} value */
function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Extract selectable OpenAI-compatible models without retaining gateway-owned fields. */
function modelProfiles(payload) {
  const source = Array.isArray(payload?.data) ? payload.data : []
  const ids = [...new Set(source.map(model => typeof model?.id === 'string' ? model.id.trim() : '').filter(Boolean))]
  return ids.map(id => ({ id, name: MODEL_DISPLAY_NAMES[id] || id }))
}

/** Exposes identity config for host consumers; login runs in the Web client. */
export class T4yIdentity {
  /**
   * @param {{ getDefaultTenantId: () => string, setTenantId: (tenantId: string | null, reason: string, moduleId?: string | null) => void }} tenant
   * @param {IdentityConfig} config
   */
  constructor(tenant, config) {
    this.tenant = tenant
    this.apiBaseUrl = typeof config.apiBaseUrl === 'string' && config.apiBaseUrl !== ''
      ? config.apiBaseUrl.replace(/\/$/, '')
      : DEFAULT_API_BASE_URL
    this.defaultTenantId = typeof config.defaultTenantId === 'string' && config.defaultTenantId !== ''
      ? config.defaultTenantId
      : tenant.getDefaultTenantId()
    this.brokerBaseUrl = requiredHttpUrl(config.brokerBaseUrl, 'brokerBaseUrl')
    this.newApiBaseUrl = requiredHttpUrl(config.newApiBaseUrl, 'newApiBaseUrl')
  }

  /** @returns {{ apiBaseUrl: string, defaultTenantId: string }} */
  publicConfig() {
    return {
      apiBaseUrl: this.apiBaseUrl,
      defaultTenantId: this.defaultTenantId,
    }
  }

  /**
   * @param {string | null} tenantId system tenant id
   * @param {string} reason
   * @param {string | null} [moduleId] enterprise id
   */
  setTenantId(tenantId, reason, moduleId) {
    this.tenant.setTenantId(tenantId, reason, moduleId)
  }

  /** Clears the host system tenant and enterprise back to the package default. */
  logout() {
    this.tenant.setTenantId(this.defaultTenantId, 'logout', null)
  }

  /**
   * Provider shell written into user settings (not a CLI overlay).
   * CLI `--patch` of `llm-pi-ai` locks `settings.update`; seeding here keeps the catalog writable.
   * @returns {{ displayName: string, apiKeyEnv: string, api: string, baseURL: string, models: [] }}
   */
  providerShell() {
    return {
      displayName: '企业模型服务',
      apiKeyEnv: MODEL_CREDENTIAL_REF,
      api: 'openai-completions',
      baseURL: this.newApiBaseUrl,
      models: [],
    }
  }

  /**
   * Ensure the New API provider route exists in writable settings before login.
   * @param {*} settings
   */
  async seedProvider(settings) {
    await settings.update(LLM_SETTINGS_NAMESPACE, {
      providers: { [LLM_PROVIDER]: this.providerShell() },
    })
  }

  /**
   * Replace the local model catalog with whatever New API returns for this Key.
   * Prefers `qwen3.8-flash` as the default when present; otherwise the first returned id.
   * @param {*} settings
   * @param {string} apiKey
   * @param {{ saveSelection?: (next: { provider: string, model: string }) => Promise<void>, currentSelection?: () => { provider: string, model: string } } | undefined} [defaultModel]
   */
  async syncModels(settings, apiKey, defaultModel) {
    let response
    try {
      response = await fetch(`${this.newApiBaseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error('newapi_unavailable')
    }
    let payload
    try { payload = await response.json() } catch { throw new Error('newapi_invalid_response') }
    const models = response.ok ? modelProfiles(payload) : []
    if (models.length === 0) throw new Error('newapi_no_models')
    await settings.update(LLM_SETTINGS_NAMESPACE, {
      providers: { [LLM_PROVIDER]: { ...this.providerShell(), models } },
    })
    const preferred = models.find(model => model.id === 'qwen3.8-flash') ?? models[0]
    if (defaultModel?.saveSelection) {
      const current = defaultModel.currentSelection?.()
      if (current?.provider !== LLM_PROVIDER || current?.model !== preferred.id) {
        await defaultModel.saveSelection({ provider: LLM_PROVIDER, model: preferred.id })
      }
    }
    return models
  }
}

/**
 * @param {*} ctx
 * @param {IdentityConfig} [config]
 */
export function apply(ctx, config = {}) {
  const identity = new T4yIdentity(ctx.t4yTenant, config ?? {})
  const enterprise = createEnterpriseAccess({
    apiBaseUrl: identity.apiBaseUrl || DEFAULT_API_BASE_URL,
  })
  ctx.provide('t4yIdentity', identity)
  // Shared Host enterprise token + outbound helpers for release-manager and future plugins.
  ctx.provide('t4yEnterprise', enterprise)
  // Provider shell must live in the writable settings layer. A CLI overlay on
  // `llm-pi-ai` would block later New API catalog sync after Key issue.
  ctx.effect(() => {
    void identity.seedProvider(ctx.settings).catch(error => {
      ctx.logger?.warn?.('t4y-identity: seedProvider failed: %s', error instanceof Error ? error.message : error)
    })
  })

  const brokerPost = async (path, authorization, body) => {
    let response
    try {
      response = await fetch(`${identity.brokerBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      return { ok: false, status: 502, payload: { error: 'broker_unavailable' } }
    }
    let payload
    try { payload = await response.json() } catch {
      return { ok: false, status: 502, payload: { error: 'broker_invalid_response' } }
    }
    return { ok: response.ok, status: response.status, payload }
  }

  /**
   * Enterprise access token for Broker / Host context (see resolveEnterpriseAccessToken).
   * @param {Request} request
   * @returns {Promise<string | null>}
   */
  const enterpriseAuthorization = (request) => resolveEnterpriseAccessToken(request)

  /**
   * Fetch an allowlisted intranet asset through the Host (phone cannot reach eims/jgyw).
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  const fetchEnterpriseAsset = async (request) => {
    let target
    try {
      target = new URL(request.url, 'http://localhost').searchParams.get('url')
    } catch {
      return json(400, { error: 'invalid_request' })
    }
    if (typeof target !== 'string' || target === '') return json(400, { error: 'invalid_request' })
    const parsed = parseAllowedEnterpriseUrl(target)
    if (!parsed) return json(400, { error: 'host_not_allowed' })
    try {
      const upstream = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
      if (!upstream.ok) {
        return new Response(null, { status: upstream.status === 404 ? 404 : 502 })
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=300',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.('t4y-enterprise: asset proxy failed: %s', message)
      return json(502, { error: 'asset_upstream_unavailable' })
    }
  }

  // 方案 B canonical asset gateway
  ctx.connection.fetch.register({
    path: ENTERPRISE_ASSET_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: fetchEnterpriseAsset,
  })
  // Compatibility alias used by older session-stored logo URLs
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/asset-proxy',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: fetchEnterpriseAsset,
  })

  /**
   * Generic enterprise API proxy: Host injects accessToken; clients never send it.
   * Body: { path: "/system/..." } or { url: "https://jgyw.../..." }, plus method/headers/body.
   */
  ctx.connection.fetch.register({
    path: ENTERPRISE_PROXY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const accessToken = await resolveEnterpriseAccessToken(request)
      if (!accessToken) return json(401, { error: 'authorization_required' })
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      const resolved = resolveEnterpriseProxyTarget(body, enterprise.apiBaseUrl)
      if (!resolved.ok) return json(400, { error: resolved.error })
      const method = typeof body?.method === 'string' ? body.method.toUpperCase() : (body?.body === undefined ? 'GET' : 'POST')
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
        return json(400, { error: 'invalid_method' })
      }
      /** @type {Record<string, string>} */
      const headers = {
        Accept: 'application/json, text/plain, */*',
      }
      const incoming = body?.headers && typeof body.headers === 'object' ? body.headers : {}
      for (const key of ['Content-Type', 'browser', 'operating-system', 'operator-type', 'module-id']) {
        const value = incoming[key]
        if (typeof value === 'string' && value !== '') headers[key] = value
      }
      // Never let the browser override Authorization — Host owns the enterprise token.
      headers.Authorization = accessToken
      let upstreamBody
      if (method !== 'GET' && body?.body !== undefined) {
        if (typeof body.body === 'string') upstreamBody = body.body
        else {
          upstreamBody = JSON.stringify(body.body)
          if (headers['Content-Type'] === undefined) headers['Content-Type'] = 'application/json'
        }
      }
      try {
        const upstream = await fetch(resolved.target.toString(), {
          method,
          headers,
          ...(upstreamBody === undefined ? {} : { body: upstreamBody }),
          signal: AbortSignal.timeout(30_000),
        })
        const contentType = upstream.headers.get('content-type') || 'application/json'
        const text = await upstream.text()
        return new Response(text, {
          status: upstream.status,
          headers: { 'content-type': contentType, 'cache-control': 'no-store' },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.('t4y-enterprise: proxy upstream failed: %s', message)
        return json(502, { error: 'enterprise_upstream_unavailable', message })
      }
    },
  })

  /**
   * Write Host t4yTenant from a client body. Returns null when the body has no
   * usable system `tenantId` (callers that require context treat that as invalid_request).
   * `moduleId` is the enterprise id. Accepts brief `enterpriseId` alias as system tenant.
   * @param {*} body
   * @param {string} fallbackReason
   * @returns {{ tenantId: string, moduleId: string | null } | null}
   */
  const applyClientContext = (body, fallbackReason) => {
    const raw = typeof body?.tenantId === 'string' && body.tenantId.trim() !== ''
      ? body.tenantId.trim()
      : (typeof body?.enterpriseId === 'string' ? body.enterpriseId.trim() : '')
    if (raw === '' || raw.includes('/') || raw.includes('..')) return null
    const moduleId = typeof body?.moduleId === 'string' && body.moduleId.trim() !== ''
      ? body.moduleId.trim()
      : null
    const reason = typeof body?.reason === 'string' && body.reason !== '' ? body.reason : fallbackReason
    identity.setTenantId(raw, reason, moduleId)
    return {
      tenantId: identity.tenant.getTenantId(),
      moduleId: identity.tenant.getModuleId(),
    }
  }

  /**
   * Allow only enterprise auth/menu paths so the proxy cannot be used as an open SSRF.
   * @param {unknown} path
   * @returns {string | null}
   */
  const normalizeEnterpriseProxyPath = (path) => {
    if (typeof path !== 'string' || path === '') return null
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('..')) return null
    const pathname = path.split('?', 1)[0] || ''
    if (!(pathname.startsWith('/auth/') || pathname.startsWith('/system/'))) return null
    if (path.length > 512) return null
    return path
  }

  /**
   * Forward browser enterprise-login calls through the Host process.
   * Mobile (cpolar/iroh) cannot reach split-DNS / firewalled public endpoints; the PC can.
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/enterprise-proxy',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      const path = normalizeEnterpriseProxyPath(body?.path)
      if (path === null) return json(400, { error: 'invalid_path' })
      const method = typeof body?.method === 'string' ? body.method.toUpperCase() : 'GET'
      if (method !== 'GET' && method !== 'POST') return json(400, { error: 'invalid_method' })

      /** @type {Record<string, string>} */
      const headers = {
        Accept: 'application/json, text/plain, */*',
      }
      const incoming = body?.headers && typeof body.headers === 'object' ? body.headers : {}
      for (const key of ['Authorization', 'Content-Type', 'browser', 'operating-system', 'operator-type']) {
        const value = incoming[key]
        if (typeof value === 'string' && value !== '') headers[key] = value
      }
      if (method === 'POST' && headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/json'
      }

      let upstream
      try {
        upstream = await fetch(`${identity.apiBaseUrl}${path}`, {
          method,
          headers,
          ...(method === 'GET' || body?.body === undefined
            ? {}
            : { body: typeof body.body === 'string' ? body.body : JSON.stringify(body.body) }),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.('t4y-identity: enterprise-proxy upstream failed: %s', message)
        return json(502, { error: 'enterprise_upstream_unavailable', message })
      }

      const contentType = upstream.headers.get('content-type') || 'application/json'
      const text = await upstream.text()
      return new Response(text, {
        status: upstream.status,
        headers: { 'content-type': contentType },
      })
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-identity/issue-model-key',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = await enterpriseAuthorization(request)
      if (!authorization) return json(401, { error: 'authorization_required' })
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      // Client already converted enterprise `expires_in` (minutes) → Broker seconds.
      const expiresIn = Number(body?.expiresIn)
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 1) return json(400, { error: 'invalid_request' })
      const moduleId = typeof body?.moduleId === 'string' ? body.moduleId.trim() : ''
      if (moduleId === '') return json(400, { error: 'invalid_request', message: 'moduleId is required' })
      const moduleName = typeof body?.moduleName === 'string' ? body.moduleName.trim() : ''
      const result = await brokerPost('/v1/session/issue', authorization, {
        expiresIn,
        moduleId,
        ...(moduleName !== '' ? { moduleName } : {}),
      })
      if (!result.ok || typeof result.payload?.apiKey !== 'string' || result.payload.apiKey === '' || typeof result.payload.expiresAt !== 'number') {
        return json(result.status === 401 ? 401 : 502, {
          error: result.payload?.error || 'broker_rejected',
          message: typeof result.payload?.message === 'string' ? result.payload.message : undefined,
        })
      }
      await ctx.credentials.set(MODEL_CREDENTIAL_REF, result.payload.apiKey)
      // Login/restore/switch can stamp Host t4yTenant in the same round-trip as Key issue.
      const context = applyClientContext(body, 'issue-model-key')
      let models
      try {
        models = await identity.syncModels(ctx.settings, result.payload.apiKey, ctx.get?.('agentDefaultModel') ?? ctx.agentDefaultModel)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return json(502, { error: 'model_catalog_unavailable', message })
      }
      return json(200, {
        expiresAt: result.payload.expiresAt,
        // New API billing wallet (module ≈ 企业); unchanged when admin switches workspace module.
        homeModuleId: typeof result.payload.homeModuleId === 'string'
          ? result.payload.homeModuleId
          : moduleId,
        models: models.map(model => ({ id: model.id, name: model.name })),
        defaultModel: models.find(model => model.id === 'qwen3.8-flash')?.id ?? models[0]?.id,
        ...(context === null ? {} : { tenantId: context.tenantId, moduleId: context.moduleId }),
      })
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-identity/session-status',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = await enterpriseAuthorization(request)
      if (!authorization) return json(401, { error: 'authorization_required' })
      // Chat AUTH deletes the local Key; treat missing credential as inactive before asking Broker.
      try {
        const resolved = await ctx.credentials.resolve(MODEL_CREDENTIAL_REF)
        if (typeof resolved?.value !== 'string' || resolved.value === '') {
          return json(200, { active: false, reason: 'key_missing' })
        }
      } catch {
        return json(200, { active: false, reason: 'key_missing' })
      }
      let body = {}
      try { body = await request.json() } catch { body = {} }
      // Key is per user; moduleId is optional (workspace context only).
      const moduleId = typeof body?.moduleId === 'string' && body.moduleId.trim() !== ''
        ? body.moduleId.trim()
        : (ctx.t4yTenant?.getModuleId?.() || '')
      const result = await brokerPost(
        '/v1/session/status',
        authorization,
        moduleId !== '' ? { moduleId } : {},
      )
      if (!result.ok) return json(result.status === 401 ? 401 : 502, { error: result.payload?.error || 'broker_rejected' })
      return json(200, {
        active: result.payload?.active === true,
        reason: typeof result.payload?.reason === 'string' ? result.payload.reason : undefined,
        expiresAt: typeof result.payload?.expiresAt === 'number' ? result.payload.expiresAt : undefined,
      })
    },
  })

  ctx.connection.fetch.register({
    path: '/api/t4y-identity/revoke-model-key',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = await enterpriseAuthorization(request)
      if (!authorization) return json(401, { error: 'authorization_required' })
      let body = {}
      try { body = await request.json() } catch { body = {} }
      // One Key per user; moduleId on body is ignored by Broker (kept for older clients).
      const result = await brokerPost('/v1/session/revoke', authorization, {})
      try { await ctx.credentials.deleteRecord(MODEL_CREDENTIAL_REF) } catch { /* best-effort local cleanup */ }
      try { await writeHostSessionFile(null) } catch { /* best-effort share clear */ }
      identity.logout()
      if (!result.ok && result.status !== 401) {
        return json(502, { error: result.payload?.error || 'broker_rejected' })
      }
      return json(200, { revoked: result.payload?.revoked === true })
    },
  })

  /**
   * Shared enterprise session for paired Mobile clients.
   * Desktop PUT after login/project pick; Mobile GET on cold boot to skip the gate.
   * Only authenticated DSH peers (cookie / pairing) can call these routes.
   */
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/host-session',
    methods: ['GET', 'PUT', 'DELETE'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') {
        const session = await readHostSessionFile()
        if (!session) return json(404, { error: 'host_session_missing' })
        // Mobile co-watch reads this over cpolar/iroh; avoid a second Host route
        // that some gateway paths reject. Desktop ignores the extra field.
        let modelKeyPresent = false
        try {
          const resolved = await ctx.credentials.resolve(MODEL_CREDENTIAL_REF)
          modelKeyPresent = typeof resolved?.value === 'string' && resolved.value !== ''
        } catch { /* treat as missing */ }
        return json(200, { session, modelKeyPresent })
      }
      if (request.method === 'DELETE') {
        await writeHostSessionFile(null)
        return json(200, { cleared: true })
      }
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      const session = sanitizeSharedSession(body?.session ?? body)
      if (!session) return json(400, { error: 'invalid_session' })
      // Only the request header (not host-session fallback) — otherwise a stale
      // Host copy could reject a legitimate Desktop re-login PUT.
      const rawHeader = request.headers.get('x-t4y-access-token') || request.headers.get('authorization')
      const headerToken = typeof rawHeader === 'string' && rawHeader.trim() !== '' ? rawHeader.trim() : null
      if (headerToken !== null && headerToken !== session.accessToken) {
        return json(400, { error: 'token_mismatch' })
      }
      await writeHostSessionFile(session)
      applyClientContext({
        tenantId: session.tenantId,
        moduleId: session.moduleId,
        reason: 'host-session-put',
      }, 'host-session-put')
      return json(200, { saved: true, moduleId: session.moduleId, tenantId: session.tenantId })
    },
  })

  // Project switch (and any path that does not re-issue a Key) updates Host t4yTenant here.
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/set-context',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = await enterpriseAuthorization(request)
      if (!authorization) return json(401, { error: 'authorization_required' })
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      const context = applyClientContext(body, 'client-context')
      if (context === null) return json(400, { error: 'invalid_request' })
      return json(200, context)
    },
  })

  // Ensure a Host directory for this project, register its Workspace, and hide
  // every other Workspace/Session so the sidebar shows only the current project.
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/project-workspace',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = await enterpriseAuthorization(request)
      if (!authorization) return json(401, { error: 'authorization_required' })
      let body
      try { body = await request.json() } catch { return json(400, { error: 'invalid_request' }) }
      const moduleId = typeof body?.moduleId === 'string' ? body.moduleId.trim() : ''
      const title = typeof body?.title === 'string' ? body.title.trim() : ''
      let path
      try {
        path = projectWorkspacePath(moduleId)
      } catch {
        return json(400, { error: 'invalid_request' })
      }
      try {
        await mkdir(path, { recursive: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return json(502, { error: 'workspace_prepare_failed', message })
      }
      let solo
      try {
        solo = await soloProjectWorkspace(ctx, {
          path,
          ...(title !== '' ? { title } : {}),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.('t4y-identity: solo project workspace failed: %s', message)
        return json(200, { moduleId, path, workspaceId: null, solo: false })
      }
      return json(200, {
        moduleId,
        path: solo.path,
        workspaceId: solo.workspaceId,
        solo: solo.workspaceId !== null,
      })
    },
  })

  // Chat/inference 401 (AUTH): drop local Key so the next status check / credential event returns to login.
  if (ctx.llm) {
    ctx.on('llm/stream', (options, next) => {
      const stream = next()
      return (async function* () {
        try {
          for await (const chunk of stream) yield chunk
        } catch (error) {
          const code = error && typeof error === 'object' ? error.code : undefined
          const provider = options?.model?.provider ?? options?.provider
          if (code === 'AUTH' && provider === LLM_PROVIDER) {
            try { await ctx.credentials.deleteRecord(MODEL_CREDENTIAL_REF) } catch { /* best-effort */ }
          }
          throw error
        }
      })()
    })
  }
}

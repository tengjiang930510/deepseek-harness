/** Host half: enterprise identity config; bridges enterprise tokens to New API keys via Broker into credential slot `T4Y_NEW_API_KEY`. */
import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** @returns {string} */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  return join(homedir(), '.dsh')
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
  ctx.provide('t4yIdentity', identity)
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

  ctx.connection.fetch.register({
    path: '/api/t4y-identity/issue-model-key',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = request.headers.get('authorization')
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
      const authorization = request.headers.get('authorization')
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
      const authorization = request.headers.get('authorization')
      if (!authorization) return json(401, { error: 'authorization_required' })
      let body = {}
      try { body = await request.json() } catch { body = {} }
      // One Key per user; moduleId on body is ignored by Broker (kept for older clients).
      const result = await brokerPost('/v1/session/revoke', authorization, {})
      try { await ctx.credentials.deleteRecord(MODEL_CREDENTIAL_REF) } catch { /* best-effort local cleanup */ }
      identity.logout()
      if (!result.ok && result.status !== 401) {
        return json(502, { error: result.payload?.error || 'broker_rejected' })
      }
      return json(200, { revoked: result.payload?.revoked === true })
    },
  })

  // Project switch (and any path that does not re-issue a Key) updates Host t4yTenant here.
  ctx.connection.fetch.register({
    path: '/api/t4y-identity/set-context',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const authorization = request.headers.get('authorization')
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
      const authorization = request.headers.get('authorization')
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

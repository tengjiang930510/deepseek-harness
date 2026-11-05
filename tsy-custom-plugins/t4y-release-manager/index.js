import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const run = promisify(execFile)

export const name = 't4y-release-manager'
export const inject = {
  pluginManager: true,
  profileContext: true,
  t4yTenant: { required: false },
  /** Shared Host enterprise token / outbound (from t4y-identity). */
  t4yEnterprise: true,
  webServer: true,
}

const STATE_FILE = '.dsh-plugin-releases.json'
const CATALOG_CACHE_FILE = '.dsh-plugin-catalog-cache.json'
const SUSPENDED_FILE = '.dsh-plugin-suspended.json'
const LEGACY_CATALOG_URL = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub/raw/master/wuhanmetro/catalog.json'
const DEFAULT_REPOSITORY = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub.git'
const DEFAULT_API_BASE_URL = 'https://jgyw.crfsdi.com.cn:51111/backendapi'
/** Hub root; latest resolves to `{base}/{projectName}/plugins/{name}/latest.json`. */
const PLUGIN_LATEST_BASE_URL = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub/raw/master'

function isAdministratorRoles(roles) {
  return Array.isArray(roles)
    && (roles.includes('admin') || roles.includes('supManager'))
}

/**
 * Resolve caller roles from the enterprise profile API.
 * @param {string} apiBaseUrl
 * @param {string | undefined} authorization
 * @returns {Promise<string[]>}
 */
async function fetchCallerRoles(apiBaseUrl, authorization) {
  if (typeof authorization !== 'string' || authorization.trim() === '') {
    throw new Error('Authentication required')
  }
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/system/user/getInfo`, {
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'operator-type': 'PC',
    },
  })
  let json
  try {
    json = await response.json()
  } catch {
    throw new Error('Failed to resolve caller roles')
  }
  if (!response.ok || json?.code !== 200) {
    throw new Error('Authentication required')
  }
  const roles = Array.isArray(json?.data?.roles)
    ? json.data.roles.filter((role) => typeof role === 'string')
    : []
  return roles
}

function emptyState(catalogUrl) {
  return { schemaVersion: 1, catalogUrl, plugins: {} }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pluginKey(projectName, name) {
  return `${projectName}/${name}`
}

/** A menu can retain a deleted or unpublished form leaf; it is not a plugin permission failure. */
function isUnavailableFormError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('待查询表单不存在') || message.includes('待查询表单异常')
}

function findFormLeaves(value, leaves = [], category = null) {
  if (!value || typeof value !== 'object') return leaves
  if (Array.isArray(value)) {
    value.forEach((item) => findFormLeaves(item, leaves, category))
    return leaves
  }
  const isLeaf = typeof value.formId === 'string' && value.formId !== ''
  if (isLeaf) leaves.push({ ...value, category })
  const directoryTitle = isObject(value.meta) && !value.meta.formId ? value.meta.title : undefined
  const nextCategory = typeof directoryTitle === 'string' && directoryTitle !== '' ? directoryTitle : category
  Object.values(value).forEach((item) => findFormLeaves(item, leaves, nextCategory))
  return leaves
}

function coordinatesFromFieldQuery(formId, response) {
  if (!isObject(response) || !Array.isArray(response.fields) || !Array.isArray(response.items)) return []
  const ids = new Map(response.fields
    .filter((field) => isObject(field) && typeof field.title === 'string' && typeof field.id === 'string')
    .map((field) => [field.title, field.id]))
  const nameId = ids.get('插件名')
  const projectNameId = ids.get('项目名')
  const categoryId = ids.get('插件种类')
  const iconId = ids.get('插件图标')
  if (nameId === undefined || projectNameId === undefined) return []
  return response.items.map((item) => ({
    formId,
    name: item?.[nameId],
    projectName: item?.[projectNameId],
    category: categoryId === undefined ? '' : item?.[categoryId],
    iconUrl: iconId === undefined || !Array.isArray(item?.[iconId]) ? undefined : item[iconId][0]?.url,
  })).filter((item) => typeof item.name === 'string' && item.name !== ''
    && typeof item.projectName === 'string' && item.projectName !== '')
    .map((item) => ({ ...item, category: typeof item.category === 'string' ? item.category.trim() : '',
      iconUrl: typeof item.iconUrl === 'string' && /^https?:\/\//i.test(item.iconUrl) ? item.iconUrl : undefined }))
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(value)}\n`)
}

/** Keeps immutable release records and delegates profile mutation to PluginManager. */
export class T4yReleaseManager {
  /**
   * @param {{ profileContext: { dir: string }, pluginManager: { installBundle: Function }, t4yTenant?: { getTenantId: () => string, catalogUrl: () => string } }} ctx
   */
  constructor(ctx) {
    this.profileDir = ctx.profileContext.dir
    this.pluginManager = ctx.pluginManager
    this.tenant = ctx.t4yTenant
    this.apiBaseUrl = DEFAULT_API_BASE_URL
    this.enablementOperations = Promise.resolve()
  }

  /**
   * Members may install/update only the newest catalog release; historical
   * install and activate require an administrator enterprise session.
   * @param {string | undefined} authorization
   * @param {'latest' | 'historical'} mode
   */
  async assertReleasePermission(authorization, mode) {
    if (mode === 'latest') return
    const roles = await fetchCallerRoles(this.apiBaseUrl, authorization)
    if (!isAdministratorRoles(roles)) {
      throw new Error('Only administrators can install or activate historical releases')
    }
  }

  get statePath() { return join(this.profileDir, STATE_FILE) }
  get cachePath() { return join(this.profileDir, CATALOG_CACHE_FILE) }
  get suspendedPath() { return join(this.profileDir, SUSPENDED_FILE) }

  async readSuspended() {
    try {
      const value = JSON.parse(await readFile(this.suspendedPath, 'utf8'))
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error('invalid suspended plugin list')
      return new Set(value)
    } catch (error) {
      if (error?.code === 'ENOENT') return new Set()
      throw error
    }
  }

  async writeSuspended(suspended) {
    const temp = `${this.suspendedPath}.${randomUUID()}.tmp`
    await mkdir(dirname(this.suspendedPath), { recursive: true })
    await writeFile(temp, `${JSON.stringify([...suspended])}\n`, { mode: 0o600 })
    await rename(temp, this.suspendedPath)
  }

  serializeEnablement(operation) {
    const result = this.enablementOperations.then(operation)
    this.enablementOperations = result.catch(() => {})
    return result
  }

  defaultCatalogUrl() {
    if (this.tenant !== undefined) return this.tenant.catalogUrl()
    return LEGACY_CATALOG_URL
  }

  expectedProjectId() {
    // Hub catalog / projectName slug (shared across modules), not enterprise.id from login.
    if (typeof this.tenant?.getCatalogProjectId === 'function') {
      return this.tenant.getCatalogProjectId()
    }
    if (typeof this.tenant?.getCatalogTenantId === 'function') {
      return this.tenant.getCatalogTenantId()
    }
    return undefined
  }

  async snapshot() {
    return clone(await this.readState())
  }

  /**
   * Return enablement for every non-platform bundle in the profile, including
   * form-authorized packages that the generic Plugins list hides.
   * Uses the unbound PluginManager listing so managed packages are not filtered out.
   */
  async bundleStates() {
    const listAll = this.listAllBundles ?? this.pluginManager.listBundles.bind(this.pluginManager)
    const bundles = await listAll()
    return bundles
      .filter((bundle) => !isPlatformPackage(bundle.name))
      .map((bundle) => ({ name: bundle.name, enabled: bundle.enabled === true }))
  }

  /**
   * Prefer the request body; otherwise use Host t4yTenant.
   * When the body carries a project, keep Host aligned so later Host callers see it.
   * @param {unknown} bodyModuleId
   * @param {string} [reason]
   * @returns {string}
   */
  resolveModuleId(bodyModuleId, reason = 'release-request') {
    const fromBody = typeof bodyModuleId === 'string' && bodyModuleId.trim() !== ''
      ? bodyModuleId.trim()
      : null
    const fromHost = typeof this.tenant?.getModuleId === 'function'
      ? this.tenant.getModuleId()
      : null
    const moduleId = fromBody ?? fromHost
    if (typeof moduleId !== 'string' || moduleId === '') throw new Error('moduleId is required')
    if (fromBody && typeof this.tenant?.setModuleId === 'function') {
      this.tenant.setModuleId(fromBody, reason)
    }
    return moduleId
  }

  /** Enable or disable one plugin after proving it is on the caller's current project menu. */
  async setAuthorizedEnabled(moduleId, name, projectName, enabled, authorization) {
    return this.serializeEnablement(async () => {
      const plugins = await this.authorizedPlugins(moduleId, authorization)
      const plugin = plugins.find((item) => item.name === name && item.projectName === projectName)
      if (plugin === undefined) throw new Error('Plugin is not authorized for the current project')
      if (isPlatformPackage(plugin.package)) throw new Error('Plugin package is reserved by the platform')
      if (typeof this.tenant?.getModuleId === 'function' && this.tenant.getModuleId() !== moduleId) throw new Error('Project changed; retry the plugin operation')
      const result = await this.pluginManager.setBundleEnabled(plugin.package, enabled)
      if (result?.application !== 'failed' && result?.application !== 'cancelled') {
        const suspended = await this.readSuspended()
        if (suspended.delete(plugin.package)) await this.writeSuspended(suspended)
      }
      return result
    })
  }

  /**
   * After a project switch: keep packages authorized for `moduleId`, disable every
   * other release-managed package that is currently enabled. Does not uninstall.
   * @param {string} moduleId
   * @param {string | undefined} authorization
   */
  async applyModule(moduleId, authorization) {
    return this.serializeEnablement(async () => {
    const activeModuleId = typeof moduleId === 'string' && moduleId.trim() !== '' ? moduleId.trim() : this.tenant?.getModuleId?.()
    if (!activeModuleId) throw new Error('moduleId is required')
    const [authorized, state, bundles, suspended] = await Promise.all([
      this.authorizedPlugins(activeModuleId, authorization),
      this.readState(),
      this.bundleStates(),
      this.readSuspended(),
    ])
    const isCurrent = () => typeof this.tenant?.getModuleId !== 'function' || this.tenant.getModuleId() === activeModuleId
    if (!isCurrent()) return { moduleId: activeModuleId, authorized: [], disabled: [], restored: [] }
    const allowed = new Set(
      authorized
        .map((plugin) => plugin.package)
        .filter((name) => typeof name === 'string' && name !== '' && !isPlatformPackage(name)),
    )
    const managed = new Set(
      Object.values(state.plugins)
        .map((entry) => entry?.package)
        .filter((name) => typeof name === 'string' && name !== '' && !isPlatformPackage(name)),
    )
    const enabledByName = new Map(bundles.map((bundle) => [bundle.name, bundle.enabled === true]))
    const disabled = []
    const restored = []
    for (const packageName of managed) {
      if (!isCurrent()) break
      if (allowed.has(packageName)) {
        if (!suspended.has(packageName)) continue
        if (!enabledByName.has(packageName)) continue
        if (enabledByName.get(packageName) !== true) {
          const result = await this.pluginManager.setBundleEnabled(packageName, true)
          if (result?.application === 'failed' || result?.application === 'cancelled') continue
          restored.push({ package: packageName, application: result?.application })
        }
        suspended.delete(packageName)
        await this.writeSuspended(suspended)
        continue
      }
      if (enabledByName.get(packageName) !== true) continue
      suspended.add(packageName)
      await this.writeSuspended(suspended)
      if (!isCurrent()) break
      const result = await this.pluginManager.setBundleEnabled(packageName, false)
      if (result?.application === 'failed' || result?.application === 'cancelled') continue
      disabled.push({
        package: packageName,
        application: result?.application,
      })
    }
    return {
      moduleId: activeModuleId,
      authorized: authorized.map((plugin) => ({
        key: plugin.key,
        package: plugin.package,
        name: plugin.name,
        projectName: plugin.projectName,
      })),
      disabled,
      restored,
    }
    })
  }

  async refreshCatalog() {
    const state = await this.readState()
    const catalog = await this.fetchCatalog(state.catalogUrl)
    return {
      catalogUrl: state.catalogUrl,
      projectId: catalog.projectId,
      plugins: catalog.plugins.map((plugin) => ({
        id: plugin.id,
        package: plugin.package,
        name: plugin.name,
        kind: plugin.kind,
        commands: plugin.commands,
        description: plugin.description,
        releases: plugin.releases.map((release) => ({
          version: release.version,
          git: release.git,
          source: release.source,
          dsh: release.dsh,
          publishedAt: release.publishedAt,
          changelog: release.changelog,
        })),
      })),
    }
  }

  /** Read the enterprise system through the caller's own access token. */
  async enterpriseRequest(path, authorization, moduleId, body) {
    if (typeof authorization !== 'string' || authorization.trim() === '') throw new Error('Authentication required')
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Authorization: authorization,
        browser: 'Safari',
        'operating-system': 'Mac/iOS',
        'operator-type': 'PC',
        'module-id': moduleId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new Error(`Enterprise API returned non-JSON HTTP ${response.status}`)
    }
    if (!response.ok || payload?.code !== 200) {
      throw new Error(typeof payload?.msg === 'string' ? payload.msg : `Enterprise API returned HTTP ${response.status}`)
    }
    return payload.data
  }

  /** Resolve only plugin records in form leaves visible to the current user. */
  async authorizedPluginCoordinates(moduleId, authorization) {
    if (typeof moduleId !== 'string' || moduleId === '') throw new Error('moduleId is required')
    const menu = await this.enterpriseRequest(
      `/system/menu/getMultiRoutersNew/${encodeURIComponent(moduleId)}?clientType=0`,
      authorization,
      moduleId,
    )
    const leaves = findFormLeaves(menu)
    const groups = await Promise.all(leaves.map(async (leaf) => {
      let records
      try {
        records = await this.enterpriseRequest(
          `/form/${encodeURIComponent(moduleId)}/data/fieldQuery`,
          authorization,
          moduleId,
          { formId: leaf.formId, queryCondition: [] },
        )
      } catch (error) {
        if (isUnavailableFormError(error)) return []
        throw error
      }
      return coordinatesFromFieldQuery(leaf.formId, records).map((coordinate) => ({
        ...coordinate,
        category: coordinate.category || leaf.category,
        menuId: typeof leaf.id === 'string' ? leaf.id : '',
        menuTitle: typeof leaf.title === 'string' && leaf.title !== '' ? leaf.title : coordinate.name,
      }))
    }))
    const coordinates = groups.flat()
    const seen = new Set()
    for (const coordinate of coordinates) {
      const key = pluginKey(coordinate.projectName, coordinate.name)
      if (seen.has(key)) throw new Error(`Duplicate plugin record: ${key}`)
      seen.add(key)
    }
    return coordinates.map((coordinate) => ({ ...coordinate, key: pluginKey(coordinate.projectName, coordinate.name) }))
  }

  /** Resolve current releases for the caller's authorized coordinates. */
  async authorizedPlugins(moduleId, authorization) {
    const coordinates = await this.authorizedPluginCoordinates(moduleId, authorization)
    return Promise.all(coordinates.map((coordinate) => this.fetchLatestPlugin(coordinate)))
  }

  /** Fetch the one maintained current release for an authorized plugin record. */
  async fetchLatestPlugin(coordinate) {
    const url = `${PLUGIN_LATEST_BASE_URL}/${encodeURIComponent(coordinate.projectName)}/plugins/${encodeURIComponent(coordinate.name)}/latest.json`
    let raw
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Gitee returned HTTP ${response.status}`)
      if (!['gitee.com', 'raw.giteeusercontent.com'].includes(new URL(response.url || url).hostname)) {
        throw new Error('Gitee redirect is not trusted')
      }
      raw = await response.json()
    } catch (error) {
      throw new Error(`Unable to read latest plugin ${pluginKey(coordinate.projectName, coordinate.name)}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const latest = isObject(raw?.latest) ? raw.latest : raw
    if (!isObject(latest) || typeof latest.package !== 'string' || latest.package === ''
      || typeof latest.version !== 'string' || latest.version === '' || typeof latest.dsh !== 'string'
      || !isObject(latest.git) || latest.git.repository !== DEFAULT_REPOSITORY
      || typeof latest.git.ref !== 'string' || !isCommit(latest.git.commit)
      || !isObject(latest.source) || !isCommit(latest.source.commit)
      || typeof latest.source.path !== 'string' || latest.source.path === ''
      || latest.source.path.startsWith('/') || latest.source.path.split('/').includes('..')) {
      throw new Error(`latest.json for ${pluginKey(coordinate.projectName, coordinate.name)} is invalid`)
    }
    if ((raw.name !== undefined && raw.name !== coordinate.name)
      || (raw.projectName !== undefined && raw.projectName !== coordinate.projectName)) {
      throw new Error(`latest.json identity does not match ${pluginKey(coordinate.projectName, coordinate.name)}`)
    }
    return {
      ...coordinate,
      key: pluginKey(coordinate.projectName, coordinate.name),
      package: latest.package,
      version: latest.version,
      commands: Array.isArray(latest.commands) ? latest.commands.filter((item) => typeof item === 'string') : [],
      description: latest.description,
      latest: {
        version: latest.version,
        git: { repository: latest.git.repository, ref: latest.git.ref, commit: latest.git.commit },
        source: { commit: latest.source.commit, path: latest.source.path },
        dsh: latest.dsh,
      },
    }
  }

  async installAuthorized(moduleId, name, projectName, authorization) {
    const plugins = await this.authorizedPlugins(moduleId, authorization)
    const plugin = plugins.find((item) => item.name === name && item.projectName === projectName)
    if (plugin === undefined) throw new Error('Plugin is not authorized for the current project')
    if (isPlatformPackage(plugin.package)) throw new Error('Plugin package is reserved by the platform')
    const release = plugin.latest
    const state = await this.readState()
    const spec = await this.releaseSpec({ id: plugin.key }, release)
    let result = await this.pluginManager.installBundle(spec, { enabled: true })
    if (result.application === 'failed' && result.error?.code === 'already-installed') {
      const removed = await this.pluginManager.removeBundle(plugin.package)
      if (removed.application === 'failed' || removed.application === 'cancelled') return removed
      result = await this.pluginManager.installBundle(spec, { enabled: true })
    }
    if (result.application === 'failed' || result.application === 'cancelled') return result
    const next = await this.readState()
    const entry = next.plugins[plugin.key] ?? { package: plugin.package, installed: [] }
    const record = {
      version: release.version,
      ref: release.git.ref,
      commit: release.git.commit,
      repository: release.git.repository,
      source: release.source,
      dsh: release.dsh,
      spec,
      installedAt: new Date().toISOString(),
    }
    entry.package = plugin.package
    entry.installed = [...entry.installed.filter((item) => item.commit !== record.commit), record]
    entry.active = { version: record.version, commit: record.commit }
    next.plugins[plugin.key] = entry
    await this.writeState(next)
    return result
  }

  async install(pluginId, version, authorization) {
    const state = await this.readState()
    const catalog = await this.fetchCatalog(state.catalogUrl)
    const plugin = catalog.plugins.find((item) => item.id === pluginId)
    const release = plugin?.releases.find((item) => item.version === version)
    if (plugin === undefined || release === undefined) throw new Error('Requested release is not in the plugin hub catalog')
    const latest = plugin.releases[plugin.releases.length - 1]
    const mode = latest !== undefined && latest.version === release.version ? 'latest' : 'historical'
    await this.assertReleasePermission(authorization, mode)
    const spec = await this.releaseSpec(plugin, release)
    let result = await this.pluginManager.installBundle(spec, { enabled: true })
    // HMR refuses to replace a live package in place. Removing that one selected
    // package first makes an administrator-requested release switch explicit and
    // leaves the release records in this manager's state intact.
    if (result.application === 'failed' && result.error?.code === 'already-installed') {
      const removed = await this.pluginManager.removeBundle(plugin.package)
      if (removed.application === 'failed' || removed.application === 'cancelled') return removed
      result = await this.pluginManager.installBundle(spec, { enabled: true })
    }
    if (result.application === 'failed' || result.application === 'cancelled') {
      await this.restoreActiveRelease(state, plugin.id, plugin.package, release.git.commit)
      return result
    }
    const next = await this.readState()
    const entry = next.plugins[plugin.id] ?? { package: plugin.package, installed: [] }
    const record = {
      version: release.version,
      ref: release.git.ref,
      commit: release.git.commit,
      repository: release.git.repository,
      source: release.source,
      dsh: release.dsh,
      spec,
      installedAt: new Date().toISOString(),
    }
    entry.package = plugin.package
    entry.installed = [...entry.installed.filter((item) => item.commit !== record.commit), record]
    entry.active = { version: record.version, commit: record.commit }
    next.plugins[plugin.id] = entry
    await this.writeState(next)
    return result
  }

  /** Restore the previously active package after a requested release cannot load. */
  async restoreActiveRelease(state, pluginId, packageName, attemptedCommit) {
    const entry = state.plugins[pluginId]
    const active = entry?.active
    if (active === undefined || active.commit === attemptedCommit) return
    const previous = entry.installed.find((item) => item.commit === active.commit)
    if (previous === undefined) return
    const removed = await this.pluginManager.removeBundle(packageName)
    if (removed.application === 'failed' || removed.application === 'cancelled') return
    await this.pluginManager.installBundle(previous.spec, { enabled: true })
  }

  async activate(pluginId, commit, authorization) {
    await this.assertReleasePermission(authorization, 'historical')
    const state = await this.readState()
    const entry = state.plugins[pluginId]
    const release = entry?.installed.find((item) => item.commit === commit)
    if (release === undefined) throw new Error('Requested release is not installed')
    const result = await this.pluginManager.installBundle(release.spec, { enabled: true })
    if (result.application === 'failed' || result.application === 'cancelled') return result
    entry.active = { version: release.version, commit: release.commit }
    await this.writeState(state)
    return result
  }

  /**
   * Materialize a versioned package directory from the Hub source tree.
   * Install uses `source.commit` + `source.path` (typically
   * `<projectName>/plugins/<name>/v<version>/`), not an orphan branch root.
   */
  async releaseSpec(plugin, release) {
    if (release.source === undefined) return `git+${release.git.repository}#${release.git.commit}`
    const root = join(this.profileDir, '.dsh-plugin-releases', plugin.id, release.source.commit, encodeURIComponent(release.version))
    const manifest = join(root, 'package.json')
    try {
      await readFile(manifest, 'utf8')
      return `file:${root}`
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const checkout = await mkdtemp(join(this.profileDir, '.dsh-plugin-release-fetch-'))
    try {
      await run('git', ['init', checkout])
      await run('git', ['-C', checkout, 'fetch', '--depth=1', release.git.repository, release.source.commit])
      await run('git', ['-C', checkout, 'checkout', '--detach', 'FETCH_HEAD'])
      const source = join(checkout, release.source.path)
      await mkdir(dirname(root), { recursive: true })
      await cp(source, root, { recursive: true })
      await readFile(manifest, 'utf8')
      return `file:${root}`
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  }

  async readState() {
    const fallbackUrl = this.defaultCatalogUrl()
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'))
      if (!isObject(parsed) || parsed.schemaVersion !== 1 || !isObject(parsed.plugins)) throw new Error('invalid state')
      return {
        schemaVersion: 1,
        // A tenant service is authoritative. This also migrates profiles that
        // stored the pre-tenant Hub URL before the tenant plugin was added.
        catalogUrl: this.tenant !== undefined ? fallbackUrl : typeof parsed.catalogUrl === 'string' ? parsed.catalogUrl : fallbackUrl,
        plugins: parsed.plugins,
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState(fallbackUrl)
      throw new Error(`Cannot read release state: ${error.message}`)
    }
  }

  async writeState(state) {
    const temp = `${this.statePath}.${process.pid}.tmp`
    await mkdir(dirname(this.statePath), { recursive: true })
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.statePath)
  }

  async writeCatalogCache(catalogUrl, catalog) {
    const temp = `${this.cachePath}.${process.pid}.tmp`
    await mkdir(dirname(this.cachePath), { recursive: true })
    await writeFile(temp, `${JSON.stringify({ catalogUrl, cachedAt: new Date().toISOString(), catalog }, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.cachePath)
  }

  async readCatalogCache(catalogUrl) {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf8'))
      if (!isObject(parsed) || parsed.catalogUrl !== catalogUrl || !isObject(parsed.catalog)) return null
      return parsed.catalog
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      return null
    }
  }

  async fetchCatalog(url) {
    let catalog
    let fromCache = false
    try {
      if (new URL(url).hostname !== 'gitee.com') throw new Error('Plugin hub catalog is not trusted')
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
      if (!['gitee.com', 'raw.giteeusercontent.com'].includes(new URL(response.url).hostname)) {
        throw new Error('Plugin hub redirect is not trusted')
      }
      if (!response.ok) throw new Error(`Plugin hub returned HTTP ${response.status}`)
      catalog = await response.json()
    } catch (error) {
      const cached = await this.readCatalogCache(url)
      if (cached === null) throw error
      catalog = cached
      fromCache = true
    }

    const parsed = this.parseCatalog(catalog)
    if (!fromCache) await this.writeCatalogCache(url, catalog)
    return { ...parsed, fromCache }
  }

  parseCatalog(catalog) {
    if (!isObject(catalog) || !Array.isArray(catalog.plugins)) throw new Error('Plugin hub catalog schema is unsupported')
    const schemaVersion = catalog.schemaVersion
    if (schemaVersion !== 3 && schemaVersion !== 4) throw new Error('Plugin hub catalog schema is unsupported')

    let projectId
    if (schemaVersion === 4) {
      // Prefer projectId; older catalogs may still use tenantId for the same Hub slug.
      projectId = typeof catalog.projectId === 'string' && catalog.projectId !== ''
        ? catalog.projectId
        : (typeof catalog.tenantId === 'string' ? catalog.tenantId : '')
      if (projectId === '') {
        throw new Error('Plugin hub catalog is missing projectId')
      }
      const expected = this.expectedProjectId()
      if (expected !== undefined && projectId !== expected) {
        throw new Error(`Plugin hub catalog projectId mismatch: expected ${expected}, got ${projectId}`)
      }
    }

    const plugins = catalog.plugins.map((plugin) => {
      if (!isObject(plugin) || typeof plugin.id !== 'string' || typeof plugin.package !== 'string' || !Array.isArray(plugin.releases)) {
        throw new Error('Plugin hub catalog contains an invalid plugin')
      }
      const releases = plugin.releases.map((release) => {
        if (!isObject(release) || typeof release.version !== 'string' || typeof release.dsh !== 'string'
          || !isObject(release.git) || release.git.repository !== DEFAULT_REPOSITORY
          || typeof release.git.ref !== 'string' || !isCommit(release.git.commit)) {
          throw new Error(`Plugin hub catalog contains an invalid release for ${plugin.id}`)
        }
        const source = isObject(release.source) && isCommit(release.source.commit) && typeof release.source.path === 'string'
          && release.source.path !== '' && !release.source.path.startsWith('/')
          && !release.source.path.split('/').includes('..')
          ? { commit: release.source.commit, path: release.source.path } : undefined
        if (source === undefined) throw new Error(`Plugin hub catalog is missing a source coordinate for ${plugin.id}`)
        return {
          version: release.version,
          git: { repository: release.git.repository, ref: release.git.ref, commit: release.git.commit },
          source,
          dsh: release.dsh,
          publishedAt: typeof release.publishedAt === 'string' ? release.publishedAt : undefined,
          changelog: release.changelog,
        }
      })
      return {
        id: plugin.id,
        package: plugin.package,
        name: plugin.name,
        kind: plugin.kind,
        commands: Array.isArray(plugin.commands) ? plugin.commands.filter((item) => typeof item === 'string') : [],
        description: plugin.description,
        releases,
      }
    })
    return { schemaVersion, projectId, plugins }
  }
}

/** Platform / shell packages that must stay on and never appear in the generic plugin manager. */
const PLATFORM_PACKAGES = new Set([
  't4y-identity',
  't4y-brand',
  't4y-tenant',
  't4y-capability-hub',
  't4y-release-manager',
  't4y-trial-runtime',
  't4y-key-broker',
])

function isPlatformPackage(name) {
  return typeof name === 'string' && PLATFORM_PACKAGES.has(name)
}

/** @param {string} name @param {'enable' | 'remove'} stage @param {boolean} [enabled] */
function refusedChange(name, stage, enabled) {
  return {
    changed: false,
    application: 'failed',
    stage,
    target: name,
    ...(enabled === undefined ? {} : { enabled }),
    error: { code: 'management-required' },
  }
}

/**
 * Keep platform and form-authorized bundles out of the generic Plugins list.
 * Form-authorized bundles are managed exclusively by the project-scoped
 * 「授权插件」page, while other third-party bundles remain visible there.
 * @param {{ listBundles: Function, setBundleEnabled: Function, removeBundle: Function, listPlugins: Function, setPluginEnabled: Function }} pluginManager
 * @param {T4yReleaseManager} manager
 * @returns {() => void} Restore the intercepted methods when the plugin unloads.
 */
export function protectPlatformBundles(pluginManager, manager) {
  const names = ['listBundles', 'setBundleEnabled', 'removeBundle', 'listPlugins', 'setPluginEnabled']
  const originals = new Map(names.map(name => [name, pluginManager[name]]))
  const managedPackages = async () => new Set(Object.values((await manager.readState()).plugins)
    .map((entry) => entry?.package)
    .filter((name) => typeof name === 'string'))
  const listBundles = pluginManager.listBundles.bind(pluginManager)
  // Keep the unbound listing for authorized-plugin enablement reads; the
  // wrapped listBundles intentionally hides those packages from the generic UI.
  manager.listAllBundles = listBundles
  pluginManager.listBundles = async () => {
    const [bundles, managed] = await Promise.all([listBundles(), managedPackages()])
    return bundles.filter((bundle) => !isPlatformPackage(bundle.name) && !managed.has(bundle.name))
  }

  const setBundleEnabled = pluginManager.setBundleEnabled.bind(pluginManager)
  pluginManager.setBundleEnabled = async (name, enabled) => {
    if (isPlatformPackage(name)) return refusedChange(name, 'enable', enabled)
    return setBundleEnabled(name, enabled)
  }

  const removeBundle = pluginManager.removeBundle.bind(pluginManager)
  pluginManager.removeBundle = async (name) => {
    if (isPlatformPackage(name)) return refusedChange(name, 'remove')
    return removeBundle(name)
  }

  const listPlugins = pluginManager.listPlugins.bind(pluginManager)
  pluginManager.listPlugins = async () => {
    const [rows, managed] = await Promise.all([listPlugins(), managedPackages()])
    return rows.filter((row) => !isPlatformPackage(row.moduleName) && !managed.has(row.moduleName))
  }

  const setPluginEnabled = pluginManager.setPluginEnabled.bind(pluginManager)
  pluginManager.setPluginEnabled = async (id, enabled) => {
    const rows = await listPlugins()
    const row = rows.find((item) => item.entryId === id)
    if (row !== undefined && isPlatformPackage(row.moduleName)) {
      return refusedChange(row.moduleName, 'enable', enabled)
    }
    return setPluginEnabled(id, enabled)
  }
  const installed = new Map(names.map(name => [name, pluginManager[name]]))
  return () => {
    for (const name of names) {
      if (pluginManager[name] === installed.get(name)) pluginManager[name] = originals.get(name)
    }
  }
}

export function apply(ctx) {
  const manager = new T4yReleaseManager(ctx)
  ctx.effect(() => protectPlatformBundles(ctx.pluginManager, manager))
  ctx.provide('t4yReleaseManager', manager)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/t4y-release',
    async handler(request, response) {
      try {
        const path = new URL(request.url || '/', 'http://localhost').pathname
        if (request.method === 'GET' && path === '/api/t4y-release/state') {
          const [state, bundles] = await Promise.all([manager.snapshot(), manager.bundleStates()])
          sendJson(response, 200, { ok: true, value: { ...state, bundles } })
          return
        }
        // Host injects enterprise token from host-session; clients need not send X-T4Y-*.
        const authorization = await ctx.t4yEnterprise.requireAccessToken(request)
        if (request.method === 'POST' && path === '/api/t4y-release/authorized-coordinates') {
          const body = await readJson(request)
          const moduleId = manager.resolveModuleId(body.moduleId, 'authorized-coordinates')
          sendJson(response, 200, { ok: true, value: await manager.authorizedPluginCoordinates(moduleId, authorization) })
          return
        }
        if (request.method === 'POST' && path === '/api/t4y-release/authorized-plugins') {
          const body = await readJson(request)
          const moduleId = manager.resolveModuleId(body.moduleId, 'authorized-plugins')
          sendJson(response, 200, { ok: true, value: await manager.authorizedPlugins(moduleId, authorization) })
          return
        }
        if (request.method === 'POST' && path === '/api/t4y-release/install-authorized') {
          const body = await readJson(request)
          if (typeof body.name !== 'string' || typeof body.projectName !== 'string') {
            throw new Error('name and projectName are required')
          }
          const moduleId = manager.resolveModuleId(body.moduleId, 'install-authorized')
          sendJson(response, 200, {
            ok: true,
            value: await manager.installAuthorized(moduleId, body.name, body.projectName, authorization),
          })
          return
        }
        if (request.method === 'POST' && path === '/api/t4y-release/set-authorized-enabled') {
          const body = await readJson(request)
          if (typeof body.name !== 'string'
            || typeof body.projectName !== 'string' || typeof body.enabled !== 'boolean') {
            throw new Error('name, projectName, and enabled are required')
          }
          const moduleId = manager.resolveModuleId(body.moduleId, 'set-authorized-enabled')
          sendJson(response, 200, {
            ok: true,
            value: await manager.setAuthorizedEnabled(moduleId, body.name, body.projectName, body.enabled, authorization),
          })
          return
        }
        if (request.method === 'POST' && path === '/api/t4y-release/apply-module') {
          const body = await readJson(request)
          sendJson(response, 200, {
            ok: true,
            value: await manager.applyModule(body.moduleId, authorization),
          })
          return
        }
        sendJson(response, 404, { ok: false, error: 'Not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = message === 'Authentication required' ? 403 : 400
        sendJson(response, status, { ok: false, error: message })
      }
    },
  }), 't4y release-manager: local Web API')
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const name = 't4y-release-manager'
export const inject = ['pluginManager', 'profileContext']

const STATE_FILE = '.dsh-plugin-releases.json'
const DEFAULT_CATALOG_URL = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub/raw/master/catalog.json'
const DEFAULT_REPOSITORY = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub.git'

function emptyState() {
  return { schemaVersion: 1, catalogUrl: DEFAULT_CATALOG_URL, plugins: {} }
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

/** Keeps immutable release records and delegates profile mutation to PluginManager. */
export class T4yReleaseManager {
  constructor(ctx) {
    this.profileDir = ctx.profileContext.dir
    this.pluginManager = ctx.pluginManager
  }

  get statePath() { return join(this.profileDir, STATE_FILE) }

  async snapshot() {
    return clone(await this.readState())
  }

  async refreshCatalog() {
    const state = await this.readState()
    const catalog = await this.fetchCatalog(state.catalogUrl)
    return {
      catalogUrl: state.catalogUrl,
      plugins: catalog.plugins.map((plugin) => ({
        id: plugin.id,
        package: plugin.package,
        name: plugin.name,
        kind: plugin.kind,
        releases: plugin.releases.map((release) => ({ version: release.version, git: release.git, dsh: release.dsh })),
      })),
    }
  }

  async install(pluginId, version) {
    const state = await this.readState()
    const catalog = await this.fetchCatalog(state.catalogUrl)
    const plugin = catalog.plugins.find((item) => item.id === pluginId)
    const release = plugin?.releases.find((item) => item.version === version)
    if (plugin === undefined || release === undefined) throw new Error('Requested release is not in the plugin hub catalog')
    const spec = `git+${release.git.repository}#${release.git.commit}`
    const result = await this.pluginManager.installBundle(spec, { enabled: true })
    if (result.application === 'failed' || result.application === 'cancelled') return result
    const next = await this.readState()
    const entry = next.plugins[plugin.id] ?? { package: plugin.package, installed: [] }
    const record = { version: release.version, ref: release.git.ref, commit: release.git.commit,
      repository: release.git.repository, dsh: release.dsh, spec, installedAt: new Date().toISOString() }
    entry.package = plugin.package
    entry.installed = [...entry.installed.filter((item) => item.commit !== record.commit), record]
    entry.active = { version: record.version, commit: record.commit }
    next.plugins[plugin.id] = entry
    await this.writeState(next)
    return result
  }

  async activate(pluginId, commit) {
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

  async readState() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'))
      if (!isObject(parsed) || parsed.schemaVersion !== 1 || !isObject(parsed.plugins)) throw new Error('invalid state')
      return {
        schemaVersion: 1,
        catalogUrl: typeof parsed.catalogUrl === 'string' ? parsed.catalogUrl : DEFAULT_CATALOG_URL,
        plugins: parsed.plugins,
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState()
      throw new Error(`Cannot read release state: ${error.message}`)
    }
  }

  async writeState(state) {
    const temp = `${this.statePath}.${process.pid}.tmp`
    await mkdir(dirname(this.statePath), { recursive: true })
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.statePath)
  }

  async fetchCatalog(url) {
    if (new URL(url).hostname !== 'gitee.com') throw new Error('Plugin hub catalog is not trusted')
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
    if (!['gitee.com', 'raw.giteeusercontent.com'].includes(new URL(response.url).hostname)) {
      throw new Error('Plugin hub redirect is not trusted')
    }
    if (!response.ok) throw new Error(`Plugin hub returned HTTP ${response.status}`)
    const catalog = await response.json()
    if (!isObject(catalog) || catalog.schemaVersion !== 3 || !Array.isArray(catalog.plugins)) throw new Error('Plugin hub catalog schema is unsupported')
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
        return { version: release.version, git: { repository: release.git.repository, ref: release.git.ref, commit: release.git.commit }, dsh: release.dsh }
      })
      return { id: plugin.id, package: plugin.package, name: plugin.name, kind: plugin.kind, releases }
    })
    return { plugins }
  }
}

export function apply(ctx) {
  ctx.provide('t4yReleaseManager', new T4yReleaseManager(ctx))
}

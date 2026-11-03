/** Optional installer-carried plugin packages for a private trial build. */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile file recording which trial plugins this installer family has seeded, by package name and version. */
export const TRIAL_PLUGINS_MARKER = 'trial-plugins.json'
/** Profile-owned copies of installer-carried plugins; dependency specs point here so the installer volume may unmount. */
export const TRIAL_PLUGINS_STORE = '.dsh-trial-plugins'
const BOOTSTRAP_PLUGINS_MANIFEST = 'desktop-bootstrap-plugins.json'

interface ProfileManifestFields {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } & Record<string, unknown> } & Record<string, unknown>
  [key: string]: unknown
}

interface BootstrapPlugin {
  directory: string
  name: string
  spec: string
}

function isLegacyInstallerResource(spec: string | undefined): boolean {
  return spec?.startsWith('file:') === true && spec.includes('/Resources/trial-plugins/')
}

/** @param name - package name under the profile trial store. */
function profileTrialSpec(name: string): string {
  return `file:${TRIAL_PLUGINS_STORE}/${name}`
}

/**
 * Persist a carried plugin under the profile and mirror it into `node_modules`.
 * @param profileDir - Desktop profile directory.
 * @param name - package name.
 * @param source - installer-carried package directory to copy.
 */
function installTrialCopy(profileDir: string, name: string, source: string): void {
  const store = join(profileDir, TRIAL_PLUGINS_STORE, name)
  const target = join(profileDir, 'node_modules', name)
  rmSync(store, { recursive: true, force: true })
  cpSync(source, store, { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(store, target, { recursive: true })
}

function readJsonObject(path: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`desktop trial plugins: invalid JSON in ${label}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`desktop trial plugins: ${label} must hold a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function readSeeded(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const seeded = readJsonObject(path, TRIAL_PLUGINS_MARKER).seeded
  if (typeof seeded !== 'object' || seeded === null || Array.isArray(seeded)
    || !Object.values(seeded).every(version => typeof version === 'string')) {
    throw new Error(`desktop trial plugins: ${TRIAL_PLUGINS_MARKER} has invalid seeded versions`)
  }
  return { ...(seeded as Record<string, string>) }
}

function bootstrapPlugins(pluginsDir: string): BootstrapPlugin[] {
  const manifestPath = join(pluginsDir, BOOTSTRAP_PLUGINS_MANIFEST)
  if (!existsSync(manifestPath)) {
    return readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({ directory: entry.name, name: entry.name, spec: `file:${join(pluginsDir, entry.name)}` }))
  }
  const manifest = readJsonObject(manifestPath, BOOTSTRAP_PLUGINS_MANIFEST)
  const plugins = manifest.plugins
  if (!Array.isArray(plugins)) throw new Error(`desktop trial plugins: ${BOOTSTRAP_PLUGINS_MANIFEST} requires plugins`)
  return plugins.map((plugin, index) => {
    if (typeof plugin !== 'object' || plugin === null || Array.isArray(plugin)) {
      throw new Error(`desktop trial plugins: ${BOOTSTRAP_PLUGINS_MANIFEST} plugin ${index} must be an object`)
    }
    const candidate = plugin as Record<string, unknown>
    if (typeof candidate.directory !== 'string' || candidate.directory === '' || candidate.directory.includes('/')
      || typeof candidate.name !== 'string' || candidate.name === '' || typeof candidate.spec !== 'string' || candidate.spec === '') {
      throw new Error(`desktop trial plugins: ${BOOTSTRAP_PLUGINS_MANIFEST} plugin ${index} is invalid`)
    }
    return { directory: candidate.directory, name: candidate.name, spec: candidate.spec }
  })
}

/**
 * Copy installer-carried plugins into the Desktop profile and enable each one once.
 *
 * A plugin is seeded only when the profile does not already declare it, so user-managed installs are untouched.
 * Installer-resource dependencies created by pre-manifest Desktop releases are migrated to the explicit bootstrap
 * set. After seeding, a plugin the user removes stays removed; one the profile still declares is replaced when the
 * installer carries another version. Recovery that disables bundles is likewise preserved.
 *
 * Dependency specs for installer-copied packages use {@link TRIAL_PLUGINS_STORE} under the profile, not the
 * installer path, so a DMG or network volume may unmount after the first seed without breaking later resolves.
 * @param profileDir - Initialized Desktop profile directory holding `package.json`.
 * @param pluginsDir - Resource directory whose children each hold one package with its production dependencies.
 */
export function seedTrialPlugins(profileDir: string, pluginsDir: string): void {
  if (!existsSync(pluginsDir)) return
  const markerPath = join(profileDir, TRIAL_PLUGINS_MARKER)
  const seeded = readSeeded(markerPath)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJsonObject(manifestPath, 'profile package.json') as ProfileManifestFields
  const dependencies: Record<string, string> = {}
  const bundles = [...manifest.dsh?.profile?.bundles ?? []]
  let changed = false
  const plugins = bootstrapPlugins(pluginsDir)
  const bootstrapNames = new Set(plugins.map(plugin => plugin.name))
  const hasBootstrapManifest = existsSync(join(pluginsDir, BOOTSTRAP_PLUGINS_MANIFEST))
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (!bootstrapNames.has(name) && isLegacyInstallerResource(spec)) {
      const index = bundles.indexOf(name)
      if (index !== -1) bundles.splice(index, 1)
      rmSync(join(profileDir, 'node_modules', name), { recursive: true, force: true })
      rmSync(join(profileDir, TRIAL_PLUGINS_STORE, name), { recursive: true, force: true })
      changed = true
      continue
    }
    dependencies[name] = spec
  }
  for (const plugin of plugins) {
    const source = join(pluginsDir, plugin.directory)
    const { name, version } = readJsonObject(join(source, 'package.json'), `${plugin.directory}/package.json`)
    if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') {
      throw new Error(`desktop trial plugins: ${plugin.directory}/package.json requires name and version`)
    }
    if (name !== plugin.name) {
      throw new Error(`desktop trial plugins: ${plugin.directory}/package.json does not match ${BOOTSTRAP_PLUGINS_MANIFEST}`)
    }
    // Manifest git/registry specs stay authoritative; bare installer copies use the profile store.
    const recordedSpec = hasBootstrapManifest ? plugin.spec : profileTrialSpec(name)
    const target = join(profileDir, 'node_modules', name)
    const store = join(profileDir, TRIAL_PLUGINS_STORE, name)
    const previous = seeded[name]
    const currentSpec = dependencies[name]
    const needsLegacyRewrite = isLegacyInstallerResource(currentSpec)
    if (previous === undefined) {
      if (name in dependencies && !isLegacyInstallerResource(dependencies[name])) continue
      dependencies[name] = recordedSpec
      if (!bundles.includes(name)) bundles.push(name)
    } else if (!(name in dependencies)) {
      // User removed the package after seeding; do not re-add it.
      continue
    } else if (
      !needsLegacyRewrite
      && previous === version
      && currentSpec === recordedSpec
      && existsSync(join(target, 'package.json'))
      && existsSync(join(store, 'package.json'))
    ) {
      continue
    }
    dependencies[name] = recordedSpec
    installTrialCopy(profileDir, name, source)
    seeded[name] = version
    changed = true
  }
  if (!changed) return
  const next: ProfileManifestFields = {
    ...manifest,
    dependencies,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
  }
  writeFileSync(manifestPath, `${JSON.stringify(next, undefined, 2)}\n`)
  writeFileSync(markerPath, `${JSON.stringify({ seeded }, undefined, 2)}\n`)
}

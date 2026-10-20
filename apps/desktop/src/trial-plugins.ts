/** Optional installer-carried plugin packages for a private trial build. */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile file recording which trial plugins this installer family has seeded, by package name and version. */
export const TRIAL_PLUGINS_MARKER = 'trial-plugins.json'

interface ProfileManifestFields {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } & Record<string, unknown> } & Record<string, unknown>
  [key: string]: unknown
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

/**
 * Copy installer-carried plugins into the Desktop profile and enable each one once.
 *
 * A plugin is seeded only when the profile does not already declare it, so user-managed installs are untouched.
 * After seeding, a plugin the user removes stays removed; one the profile still declares is replaced when the
 * installer carries another version. Recovery that disables bundles is likewise preserved.
 * @param profileDir - Initialized Desktop profile directory holding `package.json`.
 * @param pluginsDir - Resource directory whose children each hold one package with its production dependencies.
 */
export function seedTrialPlugins(profileDir: string, pluginsDir: string): void {
  if (!existsSync(pluginsDir)) return
  const markerPath = join(profileDir, TRIAL_PLUGINS_MARKER)
  const seeded = readSeeded(markerPath)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJsonObject(manifestPath, 'profile package.json') as ProfileManifestFields
  const dependencies = { ...manifest.dependencies }
  const bundles = [...manifest.dsh?.profile?.bundles ?? []]
  let changed = false
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(pluginsDir, entry.name)
    const { name, version } = readJsonObject(join(source, 'package.json'), `${entry.name}/package.json`)
    if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') {
      throw new Error(`desktop trial plugins: ${entry.name}/package.json requires name and version`)
    }
    const target = join(profileDir, 'node_modules', name)
    const previous = seeded[name]
    if (previous === undefined) {
      if (name in dependencies) continue
      dependencies[name] = `file:${source}`
      if (!bundles.includes(name)) bundles.push(name)
    } else if (!(name in dependencies) || (previous === version && existsSync(join(target, 'package.json')))) {
      continue
    }
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true })
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

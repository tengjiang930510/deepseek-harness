import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seedTrialPlugins, TRIAL_PLUGINS_MARKER } from '../src/trial-plugins.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Manifest { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }

function setup(): { profile: string; plugins: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-trial-plugins-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const plugins = join(root, 'trial-plugins')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  return { profile, plugins }
}

function carry(plugins: string, name: string, version: string): void {
  const dir = join(plugins, name)
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  writeFileSync(join(dir, 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }))
}

function manifest(profile: string): Manifest {
  return JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as Manifest
}

function installedVersion(profile: string, name: string): string {
  return (JSON.parse(readFileSync(join(profile, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version
}

describe('trial plugin seeding', () => {
  it('ignores an installer without trial plugins', () => {
    const { profile, plugins } = setup()
    seedTrialPlugins(profile, plugins)
    expect(manifest(profile).dependencies).toEqual({})
    expect(existsSync(join(profile, TRIAL_PLUGINS_MARKER))).toBe(false)
  })

  it('copies each carried plugin with its dependencies and enables it after the built-in bundles', () => {
    const { profile, plugins } = setup()
    carry(plugins, 'plugin-a', '1.0.0')
    seedTrialPlugins(profile, plugins)
    expect(manifest(profile).dependencies).toEqual({ 'plugin-a': `file:${join(plugins, 'plugin-a')}` })
    expect(manifest(profile).dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'plugin-a'])
    expect(installedVersion(profile, 'plugin-a')).toBe('1.0.0')
    expect(existsSync(join(profile, 'node_modules', 'plugin-a', 'node_modules', 'dep', 'package.json'))).toBe(true)
  })

  it('keeps a plugin the user removed after seeding removed', () => {
    const { profile, plugins } = setup()
    carry(plugins, 'plugin-a', '1.0.0')
    seedTrialPlugins(profile, plugins)
    const removed = manifest(profile)
    removed.dependencies = {}
    removed.dsh.profile.bundles = removed.dsh.profile.bundles.filter(name => name !== 'plugin-a')
    writeFileSync(join(profile, 'package.json'), JSON.stringify(removed))
    carry(plugins, 'plugin-a', '2.0.0')
    seedTrialPlugins(profile, plugins)
    expect(manifest(profile).dependencies).toEqual({})
    expect(manifest(profile).dsh.profile.bundles).not.toContain('plugin-a')
  })

  it('replaces a seeded plugin when the installer carries another version', () => {
    const { profile, plugins } = setup()
    carry(plugins, 'plugin-a', '1.0.0')
    seedTrialPlugins(profile, plugins)
    carry(plugins, 'plugin-a', '2.0.0')
    seedTrialPlugins(profile, plugins)
    expect(installedVersion(profile, 'plugin-a')).toBe('2.0.0')
    expect(manifest(profile).dsh.profile.bundles.filter(name => name === 'plugin-a')).toHaveLength(1)
  })

  it('leaves a plugin the profile already declares under its own spec', () => {
    const { profile, plugins } = setup()
    const own = manifest(profile)
    own.dependencies['plugin-a'] = 'link:/somewhere/plugin-a'
    writeFileSync(join(profile, 'package.json'), JSON.stringify(own))
    carry(plugins, 'plugin-a', '1.0.0')
    seedTrialPlugins(profile, plugins)
    expect(manifest(profile).dependencies['plugin-a']).toBe('link:/somewhere/plugin-a')
    expect(existsSync(join(profile, 'node_modules', 'plugin-a'))).toBe(false)
  })

  it('rejects a carried plugin without a name and version', () => {
    const { profile, plugins } = setup()
    mkdirSync(join(plugins, 'broken'), { recursive: true })
    writeFileSync(join(plugins, 'broken', 'package.json'), JSON.stringify({ name: 'broken' }))
    expect(() => { seedTrialPlugins(profile, plugins) }).toThrow('requires name and version')
  })
})

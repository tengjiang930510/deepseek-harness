import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, type TestContext } from 'vitest'
import { stageDesktopSourceResources } from '../scripts/source-resources.ts'
import { seedTrialPlugins } from '../src/trial-plugins.ts'
import { createPluginProfile } from '../src/project-manager.ts'

function fixture(context: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-source-resources-')))
  context.onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const plugin = join(root, 'tsy-custom-plugins', 'custom-a')
  mkdirSync(plugin, { recursive: true })
  const manifest = {
    name: 'custom-a', version: '1.0.0', files: ['index.js', 'patch.yml'],
    dsh: { bundle: { patch: 'patch.yml' } }, dependencies: { dep: '1.0.0' },
    optionalDependencies: { absent: '1.0.0' }, scripts: { prepare: 'exit 1' }, devDependencies: { development: '*' },
  }
  writeFileSync(join(plugin, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(plugin, 'index.js'), 'export const plugin = true\n')
  writeFileSync(join(plugin, 'patch.yml'), '- insert: []\n')
  const dependency = join(plugin, 'node_modules', 'dep')
  mkdirSync(dependency, { recursive: true })
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0', dependencies: { leaf: '1.0.0' } }))
  writeFileSync(join(dependency, 'index.js'), 'production dependency\n')
  mkdirSync(join(plugin, 'node_modules', 'leaf'), { recursive: true })
  writeFileSync(join(plugin, 'node_modules', 'leaf', 'package.json'), JSON.stringify({ name: 'leaf', version: '1.0.0' }))
  writeFileSync(join(root, '.env'), 'PACKAGED_TEST_TOKEN=fixture-only\n')
  return { root, plugin, manifest, output: join(root, 'apps/desktop/.desktop-build/source-resources') }
}

it('carries production files and dotenv independently of the source checkout and seeds bundles once', (context) => {
  const f = fixture(context)
  expect(stageDesktopSourceResources(f.root)).toEqual(['custom-a'])
  expect(readFileSync(join(f.output, 'runtime-defaults.env'), 'utf8')).toBe('PACKAGED_TEST_TOKEN=fixture-only\n')
  const published: unknown = JSON.parse(readFileSync(join(f.output, 'plugins', 'custom-a', 'package.json'), 'utf8'))
  expect(published).not.toHaveProperty('scripts')
  expect(published).not.toHaveProperty('devDependencies')
  rmSync(join(f.root, 'tsy-custom-plugins'), { recursive: true })
  const profile = join(f.root, 'installed-profile')
  createPluginProfile(profile)
  seedTrialPlugins(profile, join(f.output, 'plugins'))
  expect(readFileSync(join(profile, 'node_modules/custom-a/index.js'), 'utf8')).toContain('plugin = true')
  expect(readFileSync(join(profile, 'node_modules/custom-a/node_modules/dep/index.js'), 'utf8')).toBe('production dependency\n')
  expect(existsSync(join(profile, 'node_modules/custom-a/node_modules/leaf/package.json'))).toBe(true)
  const manifestFile = join(profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  expect(manifest.dsh.profile.bundles).toContain('custom-a')
  manifest.dsh.profile.bundles = []
  writeFileSync(manifestFile, JSON.stringify(manifest))
  seedTrialPlugins(profile, join(f.output, 'plugins'))
  expect(JSON.parse(readFileSync(manifestFile, 'utf8'))).toMatchObject({ dsh: { profile: { bundles: [] } } })
})

it('removes stale dotenv and plugins when the next build has no source resources', (context) => {
  const f = fixture(context)
  stageDesktopSourceResources(f.root)
  rmSync(join(f.root, 'tsy-custom-plugins'), { recursive: true })
  rmSync(join(f.root, '.env'))
  expect(stageDesktopSourceResources(f.root)).toEqual([])
  expect(existsSync(join(f.output, 'plugins'))).toBe(false)
  expect(existsSync(join(f.output, 'runtime-defaults.env'))).toBe(false)
})

it('ships configured installed bundles with local bundles and rejects missing, duplicate, or non-bundle packages', (context) => {
  const f = fixture(context)
  const application = join(f.root, 'apps', 'desktop')
  mkdirSync(application, { recursive: true })
  const settings = join(application, 'packaged-plugins.json')
  writeFileSync(settings, JSON.stringify({ packages: ['external-bundle'] }))
  expect(() => stageDesktopSourceResources(f.root)).toThrow('packaged bundle external-bundle is missing')
  const installed = join(application, 'node_modules', 'external-bundle')
  mkdirSync(installed, { recursive: true })
  const manifestFile = join(installed, 'package.json')
  writeFileSync(manifestFile, JSON.stringify({ name: 'external-bundle', version: '2.0.0', files: ['patch.yml'] }))
  expect(() => stageDesktopSourceResources(f.root)).toThrow()
  // npm file allowlists may name source directories absent from the published tarball.
  writeFileSync(manifestFile, JSON.stringify({ name: 'external-bundle', version: '2.0.0', files: ['patch.yml', 'src'],
    dsh: { bundle: { patch: 'patch.yml' } } }))
  writeFileSync(join(installed, 'patch.yml'), '- insert: []\n')
  expect(stageDesktopSourceResources(f.root)).toEqual(['custom-a', 'external-bundle'])
  const profile = join(f.root, 'installed-profile')
  createPluginProfile(profile)
  seedTrialPlugins(profile, join(f.output, 'plugins'))
  const profileManifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  expect(profileManifest.dsh.profile.bundles).toContain('custom-a')
  expect(profileManifest.dsh.profile.bundles).toContain('external-bundle')
  writeFileSync(settings, JSON.stringify({ packages: ['custom-a'] }))
  expect(() => stageDesktopSourceResources(f.root)).toThrow('duplicate packaged bundle custom-a')
})

it('stops packaging when a bundle lacks its production dependency or published file', (context) => {
  const f = fixture(context)
  rmSync(join(f.plugin, 'node_modules', 'dep'), { recursive: true })
  expect(() => stageDesktopSourceResources(f.root)).toThrow('missing dependency dep')
  rmSync(join(f.plugin, 'index.js'))
  expect(() => stageDesktopSourceResources(f.root)).toThrow('missing index.js')
})

it('rejects published paths outside the package and conflicting flattened dependency versions', (context) => {
  const f = fixture(context)
  const manifestFile = join(f.plugin, 'package.json')
  writeFileSync(manifestFile, JSON.stringify({ ...f.manifest, files: ['../outside.js'] }))
  expect(() => stageDesktopSourceResources(f.root)).toThrow('escapes custom-a')
  writeFileSync(manifestFile, JSON.stringify({ ...f.manifest, dependencies: { dep: '1.0.0', leaf: '1.0.0' } }))
  const nested = join(f.plugin, 'node_modules/dep/node_modules/leaf')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'leaf', version: '2.0.0' }))
  expect(() => stageDesktopSourceResources(f.root)).toThrow('conflicting installed versions of leaf')
})

it('rejects dotenv bootstrap settings without printing private values', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.root, '.env'), 'NODE_OPTIONS=--inspect\nPACKAGED_TEST_TOKEN=private-fixture-value\n')
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !['DSH_HOME', 'TSX_TSCONFIG_PATH'].includes(name.toUpperCase())))
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
    fileURLToPath(new URL('../scripts/source-resources.ts', import.meta.url)), '--root', f.root], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...inherited, DSH_HOME: join(f.root, 'home'),
      TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)) },
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('NODE_OPTIONS')
  expect(result.stderr).not.toContain('private-fixture-value')
  expect(existsSync(f.output)).toBe(false)
})

it('queries latest for each build, installs the resolved version in isolation, and stops on lookup failure', (context) => {
  const f = fixture(context)
  const application = join(f.root, 'apps', 'desktop')
  mkdirSync(application, { recursive: true })
  writeFileSync(join(application, 'packaged-plugins.json'), JSON.stringify({ packages: ['external-bundle'] }))
  const registry = join(f.root, 'registry-version.txt')
  const manager = join(f.root, 'pnpm.mjs')
  writeFileSync(manager, `
    import assert from 'node:assert/strict'
    import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    const version = readFileSync(${JSON.stringify(registry)}, 'utf8')
    if (process.argv[2] === 'view') {
      assert.equal(process.argv[3], 'external-bundle@latest')
      if (version === 'offline') process.exit(7)
      console.log(JSON.stringify(version))
    } else {
      assert.equal(process.argv[2], 'install')
      assert(process.argv.includes('--ignore-scripts'))
      assert(process.argv.includes('--lockfile=false'))
      assert(process.argv.includes('--config.auto-install-peers=false'))
      assert(!existsSync('pnpm-lock.yaml'))
      const request = JSON.parse(readFileSync('package.json', 'utf8'))
      assert.equal(request.dependencies['external-bundle'], version)
      const directory = join('node_modules', 'external-bundle')
      assert(!existsSync(directory))
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({name:'external-bundle', version,
        dsh: {bundle:{patch:'patch.yml'}}}))
      writeFileSync(join(directory, 'patch.yml'), '- insert: []\\n')
    }
  `)
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !['NPM_EXECPATH', 'DSH_HOME', 'TSX_TSCONFIG_PATH'].includes(name.toUpperCase())))
  const run = () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
    fileURLToPath(new URL('../scripts/source-resources.ts', import.meta.url)), '--root', f.root], {
    encoding: 'utf8', timeout: 30_000, env: { ...inherited, npm_execpath: manager,
      DSH_HOME: join(f.root, 'home'), TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)) },
  })
  for (const version of ['1.0.0', '2.0.0']) {
    writeFileSync(registry, version)
    const result = run()
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(f.output, 'packaged-plugins.json'), 'utf8')).toContain(`"version": "${version}"`)
  }
  writeFileSync(registry, 'offline')
  const failed = run()
  expect(failed.error).toBeUndefined()
  expect(failed.signal).toBeNull()
  expect(failed.status).not.toBe(0)
  expect(failed.stderr).toContain('latest version lookup failed')
  expect(readdirSync(join(application, '.desktop-build', 'packaged-plugin-downloads'))).toEqual([])
})

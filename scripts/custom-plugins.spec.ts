import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, type TestContext } from 'vitest'
import { discoverCustomPlugins, registerCustomPlugins } from './custom-plugins.ts'

async function fixture(context: TestContext, profileName: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-plugins-'))
  context.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const checkout = join(root, 'checkout')
  const profileDir = join(root, 'home', 'profiles', profileName)
  const directory = join(checkout, 'tsy-custom-plugins', 'custom-a')
  await mkdir(directory, { recursive: true })
  await mkdir(profileDir, { recursive: true })
  const packageFile = join(directory, 'package.json')
  const manifest = { name: 'custom-a', dsh: { bundle: { patch: 'cordis.patch.yml' } } }
  await writeFile(packageFile, JSON.stringify(manifest))
  await writeFile(join(directory, 'cordis.patch.yml'), '- insert: []\n')
  const profileFile = join(profileDir, 'package.json')
  const profile = { dependencies: {} as Record<string, string>, dsh: { profile: { bundles: ['base', 'web'] } } }
  await writeFile(profileFile, JSON.stringify(profile))
  const installs: string[][] = []
  const install = async (specs: readonly string[]) => {
    installs.push([...specs])
    for (const spec of specs) {
      const source = spec.slice('link:'.length)
      profile.dependencies['custom-a'] = spec.replaceAll('\\', '/')
      if (!profile.dsh.profile.bundles.includes('custom-a') && installs.length === 1) profile.dsh.profile.bundles.push('custom-a')
      const target = join(profileDir, 'node_modules', 'custom-a')
      await mkdir(join(profileDir, 'node_modules'), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    }
    await writeFile(profileFile, JSON.stringify(profile))
  }
  return { root, checkout, profileDir, directory, packageFile, manifest, profileFile, profile, installs, install }
}

describe.each(['web', 'desktop'])('source %s custom plugin registration', (profileName) => {
  it('registers a new bundle once across concurrent and repeated starts', async (context) => {
    const f = await fixture(context, profileName)
    const options = { profileDir: f.profileDir, install: f.install }
    await Promise.all([registerCustomPlugins(f.checkout, options), registerCustomPlugins(f.checkout, options)])
    await registerCustomPlugins(f.checkout, options)
    expect(f.installs).toEqual([[`link:${f.directory}`]])
    expect(JSON.parse(await readFile(f.profileFile, 'utf8'))).toMatchObject({
      dsh: { profile: { bundles: ['base', 'web', 'custom-a'] } },
    })
  })

  it('preserves bundle deselection and explicit removal', async (context) => {
    const f = await fixture(context, profileName)
    const options = { profileDir: f.profileDir, install: f.install }
    await registerCustomPlugins(f.checkout, options)
    f.profile.dsh.profile.bundles = ['base', 'web']
    await writeFile(f.profileFile, JSON.stringify(f.profile))
    await registerCustomPlugins(f.checkout, options)
    expect(JSON.parse(await readFile(f.profileFile, 'utf8'))).toMatchObject({
      dsh: { profile: { bundles: ['base', 'web'] } },
    })
    delete f.profile.dependencies['custom-a']
    await writeFile(f.profileFile, JSON.stringify(f.profile))
    await registerCustomPlugins(f.checkout, options)
    expect(f.installs).toHaveLength(1)
  })

  it('repairs a moved checkout link while retaining bundle deselection', async (context) => {
    const f = await fixture(context, profileName)
    const options = { profileDir: f.profileDir, install: f.install }
    await registerCustomPlugins(f.checkout, options)
    f.profile.dsh.profile.bundles = ['base', 'web']
    await writeFile(f.profileFile, JSON.stringify(f.profile))
    const relocated = join(f.root, 'relocated')
    const directory = join(relocated, 'tsy-custom-plugins', 'custom-a')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify(f.manifest))
    await writeFile(join(directory, 'cordis.patch.yml'), '- insert: []\n')
    await registerCustomPlugins(relocated, options)
    expect(f.installs.at(-1)).toEqual([`link:${directory}`])
    expect(JSON.parse(await readFile(f.profileFile, 'utf8'))).toMatchObject({
      dsh: { profile: { bundles: ['base', 'web'] } },
    })
  })

  it('leaves registry-installed packages under user management', async (context) => {
    const f = await fixture(context, profileName)
    f.profile.dependencies['custom-a'] = '^1.0.0'
    await writeFile(f.profileFile, JSON.stringify(f.profile))
    await registerCustomPlugins(f.checkout, { profileDir: f.profileDir, install: f.install })
    expect(f.installs).toEqual([])
  })

  it('retries failed registration without recording the plugin as removed', async (context) => {
    const f = await fixture(context, profileName)
    await expect(registerCustomPlugins(f.checkout, {
      profileDir: f.profileDir,
      install: async () => { throw new Error('installation failed') },
    })).rejects.toThrow('installation failed')
    await registerCustomPlugins(f.checkout, { profileDir: f.profileDir, install: f.install })
    expect(f.installs).toHaveLength(1)
  })

  it('reports missing prepared dependencies before installing a profile link', async (context) => {
    const f = await fixture(context, profileName)
    await writeFile(f.packageFile, JSON.stringify({ ...f.manifest, dependencies: { playwright: '*' } }))
    await expect(registerCustomPlugins(f.checkout, { profileDir: f.profileDir, install: f.install }))
      .rejects.toThrow('run pnpm run build')
    expect(f.installs).toEqual([])
  })

  it('rejects duplicate package names and missing declared patches', async (context) => {
    const f = await fixture(context, profileName)
    const duplicate = join(f.checkout, 'tsy-custom-plugins', 'custom-b')
    await mkdir(duplicate)
    await writeFile(join(duplicate, 'package.json'), JSON.stringify(f.manifest))
    expect(() => discoverCustomPlugins(f.checkout)).toThrow('duplicate package custom-a')
    await writeFile(join(duplicate, 'package.json'), JSON.stringify({ ...f.manifest, name: 'custom-b' }))
    expect(() => discoverCustomPlugins(f.checkout)).toThrow('missing patch')
  })
})

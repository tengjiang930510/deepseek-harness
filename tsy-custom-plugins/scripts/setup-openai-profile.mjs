/** Migrate the former in-tree OpenAI bundle without rewriting user model or credential settings. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const host = createRequire(join(repo, 'apps/cli/package.json'))
const { initProfile, resolveProfileDir, readProfileManifest, writeProfileManifest } =
  await import(pathToFileURL(host.resolve('@deepseek-ai/dsh-app-boot')).href)
const boot = createRequire(host.resolve('@deepseek-ai/dsh-app-boot/package.json'))
const { withFileLock } = await import(pathToFileURL(boot.resolve('@deepseek-ai/dsh-atomic-write')).href)
const dir = resolveProfileDir('openai')
initProfile(dir, ['@deepseek-ai/dsh-base'])
const filename = join(dir, 'package.json')
const patch = join(dir, 'cordis.patch.yml')
const patchBefore = readFileSync(patch)
const legacy = new Set(['@deepseek-ai/dsh-openai-app', '@deepseek-ai/dsh-openai-server'])
await withFileLock(filename, async () => {
  const manifest = readProfileManifest('dsh', dir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.some(name => legacy.has(name))
      && !Object.keys(manifest.dependencies ?? {}).some(name => legacy.has(name))) return
  const backup = join(dir, 'package.before-custom-openai.json')
  if (!existsSync(backup)) writeFileSync(backup, readFileSync(filename), { mode: 0o600, flag: 'wx' })
  const dependencies = { ...manifest.dependencies }
  for (const name of legacy) delete dependencies[name]
  const migrated = bundles.flatMap(name => name === '@deepseek-ai/dsh-openai-app'
    ? ['t4y-openai-service'] : legacy.has(name) ? [] : [name])
  writeProfileManifest(dir, { ...manifest, dependencies,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...new Set(migrated)] } },
  })
})
const result = spawnSync(process.execPath, [
  '--import', host.resolve('tsx/esm'), join(repo, 'apps/cli/src/bin.ts'),
  'plugin', '--profile', 'openai', 'add', `link:${join(repo, 'tsy-custom-plugins/t4y-openai-service')}`,
], { cwd: repo, env: process.env, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error(`OpenAI profile installation failed (${result.status ?? result.signal}); the original manifest backup remains in ${dir}`)
if (!readFileSync(patch).equals(patchBefore)) throw new Error(`Profile user patch changed during setup: ${patch}`)
console.log(`OpenAI profile ready: ${dir}. Restart the foreground dsh openai process to load it.`)

/**
 * Mirror tsy-custom-plugins into the Desktop profile(s) used by unpackaged
 * `start:desktop` and the user's ~/.dsh desktop profile.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_MOBILE_SPEC, T4Y_PLUGIN_NAMES } from './enterprise-desktop-plugins.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginsRoot = path.join(repoRoot, 'tsy-custom-plugins')

const home = process.env.USERPROFILE || process.env.HOME || ''
const profileDirs = [
  path.join(home, '.dsh', 'profiles', 'desktop'),
  path.join(repoRoot, 'apps/desktop/.desktop-build/development/home/profiles/desktop'),
].filter(dir => dir && fs.existsSync(path.join(dir, 'package.json')))

if (profileDirs.length === 0) {
  throw new Error('No desktop profile found. Launch Desktop once, quit it, then re-run.')
}

for (const name of T4Y_PLUGIN_NAMES) {
  const dir = path.join(pluginsRoot, name)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`missing plugin package: ${name}`)
  }
}

for (const profileDir of profileDirs) {
  const pkgPath = path.join(profileDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const dependencies = { ...(pkg.dependencies ?? {}) }
  for (const name of T4Y_PLUGIN_NAMES) {
    dependencies[name] = `link:${path.join(pluginsRoot, name)}`
  }
  dependencies['dsh-mobile'] = DSH_MOBILE_SPEC
  const baseBundles = (pkg.dsh?.profile?.bundles ?? [])
    .filter(name => typeof name === 'string' && !name.startsWith('t4y-') && name !== 'dsh-mobile')
  const bundles = [...baseBundles, 'dsh-mobile', ...T4Y_PLUGIN_NAMES]
  pkg.dependencies = dependencies
  pkg.dsh = { profile: { bundles } }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`updated ${pkgPath}`)

  execFileSync('pnpm', ['install'], { cwd: profileDir, stdio: 'inherit', shell: true })
  for (const name of T4Y_PLUGIN_NAMES) {
    const linked = path.join(profileDir, 'node_modules', name)
    if (!fs.existsSync(linked)) throw new Error(`link missing after install: ${linked}`)
  }
  if (!fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-mobile'))) {
    throw new Error(`dsh-mobile missing after install: ${profileDir}`)
  }
  console.log(`installed dsh-mobile@${DSH_MOBILE_SPEC}, ${T4Y_PLUGIN_NAMES.join(', ')} → ${profileDir}`)
}

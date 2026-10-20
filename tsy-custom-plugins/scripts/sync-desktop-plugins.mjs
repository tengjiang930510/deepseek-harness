/**
 * Mirror tsy-custom-plugins into the Desktop profile(s) used by unpackaged
 * `start:desktop` and the user's ~/.dsh desktop profile.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginsRoot = path.join(repoRoot, 'tsy-custom-plugins')

/** Same order as the web profile for a predictable loader graph. */
const PLUGIN_NAMES = [
  't4y-review',
  't4y-bilibili-search',
  't4y-capability-hub',
  't4y-brand',
]

const profileDirs = [
  path.join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop'),
  path.join(repoRoot, 'apps/desktop/.desktop-build/development/home/profiles/desktop'),
].filter(dir => dir && fs.existsSync(path.join(dir, 'package.json')))

if (profileDirs.length === 0) {
  throw new Error('No desktop profile found. Launch Desktop once, quit it, then re-run.')
}

for (const name of PLUGIN_NAMES) {
  const dir = path.join(pluginsRoot, name)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`missing plugin package: ${name}`)
  }
}

for (const profileDir of profileDirs) {
  const pkgPath = path.join(profileDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const dependencies = { ...(pkg.dependencies ?? {}) }
  for (const name of PLUGIN_NAMES) {
    dependencies[name] = `link:${path.join(pluginsRoot, name)}`
  }
  const baseBundles = (pkg.dsh?.profile?.bundles ?? [])
    .filter(name => typeof name === 'string' && !name.startsWith('t4y-'))
  const bundles = [...baseBundles, ...PLUGIN_NAMES]
  pkg.dependencies = dependencies
  pkg.dsh = { profile: { bundles } }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`updated ${pkgPath}`)

  execFileSync('pnpm', ['install'], { cwd: profileDir, stdio: 'inherit', shell: true })
  for (const name of PLUGIN_NAMES) {
    const linked = path.join(profileDir, 'node_modules', name)
    if (!fs.existsSync(linked)) throw new Error(`link missing after install: ${linked}`)
  }
  console.log(`installed ${PLUGIN_NAMES.join(', ')} → ${profileDir}`)
}

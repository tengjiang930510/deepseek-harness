/**
 * Stage the t4y plugins for a packaged Desktop trial build.
 *
 * Writes `apps/desktop/.desktop-build/trial-plugins/<plugin>/` with each package's published files and a flat,
 * dereferenced copy of its production dependency closure, then points `DSH_DESKTOP_TRIAL_PLUGINS_DIR` in the
 * local macOS and Windows packaging files at that directory. Packaged Desktop seeds these plugins into its profile on first launch.
 * Usage: node tsy-custom-plugins/scripts/stage-desktop-trial-plugins.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGINS = [
  't4y-tenant',
  't4y-identity',
  't4y-brand',
  't4y-capability-hub',
  't4y-release-manager',
  't4y-trial-runtime',
]
const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pluginsRoot, '..')
const desktopRoot = path.join(repoRoot, 'apps/desktop')
const output = path.join(desktopRoot, '.desktop-build/trial-plugins')
const envFiles = ['.env.macos', '.env.windows'].map(file => path.join(desktopRoot, file))
const ENV_LINE = 'DSH_DESKTOP_TRIAL_PLUGINS_DIR=.desktop-build/trial-plugins'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Find `name` the way Node does: the nearest `node_modules/name` walking up from `fromDir`. */
function findPackage(fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    if (path.dirname(dir) === dir) return undefined
  }
}

/** Copy the production dependency closure of `packageDir` flat into `targetModules`. */
function copyDependencies(packageDir, targetModules, copied) {
  const manifest = readJson(path.join(packageDir, 'package.json'))
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}))
  const names = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...optional])]
  for (const name of names) {
    if (copied.has(name)) continue
    const source = findPackage(packageDir, name)
    if (source === undefined) {
      if (optional.has(name)) continue
      throw new Error(`stage: ${manifest.name} depends on ${name}, which is not installed`)
    }
    copied.add(name)
    fs.cpSync(source, path.join(targetModules, name), { recursive: true, dereference: true })
    copyDependencies(source, targetModules, copied)
  }
}

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
// Omit the development bootstrap manifest from the installer. With no manifest,
// Desktop seeds each carried package through its local `file:` path rather than
// persisting a Git release reference for an initial plugin.
for (const plugin of PLUGINS) {
  const source = path.join(pluginsRoot, plugin)
  const target = path.join(output, plugin)
  const manifest = readJson(path.join(source, 'package.json'))
  fs.mkdirSync(target, { recursive: true })
  for (const entry of manifest.files ?? []) {
    const from = path.join(source, entry)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(target, entry), { recursive: true, dereference: true })
  }
  // Install-time scripts would rerun build or browser download if pnpm later reinstalls from this copy.
  const { scripts: _scripts, devDependencies: _dev, ...published } = manifest
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(published, undefined, 2)}\n`)
  copyDependencies(source, path.join(target, 'node_modules'), new Set())
  console.log(`staged ${manifest.name}@${manifest.version}`)
}

for (const envFile of envFiles) {
  const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
  const next = /^DSH_DESKTOP_TRIAL_PLUGINS_DIR=/m.test(env)
    ? env.replace(/^DSH_DESKTOP_TRIAL_PLUGINS_DIR=.*$/m, ENV_LINE)
    : `${env.replace(/\s*$/, '')}\n${ENV_LINE}\n`
  if (next !== env) {
    fs.writeFileSync(envFile, next)
    console.log(`set ${ENV_LINE} in apps/desktop/${path.basename(envFile)}`)
  }
}

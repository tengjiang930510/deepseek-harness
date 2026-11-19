/**
 * Stage enterprise Desktop trial plugins for a packaged build.
 *
 * Writes `apps/desktop/.desktop-build/trial-plugins/<plugin>/` with each package's published files and a flat,
 * dereferenced copy of its production dependency closure, then points `DSH_DESKTOP_TRIAL_PLUGINS_DIR` in the
 * local macOS and Windows packaging files at that directory. Packaged Desktop force-seeds these plugins into
 * its profile on launch (installer wins over registry/link copies).
 *
 * Includes pinned `dsh-mobile` (npm) plus the tree-local `t4y-*` set.
 * Usage: node tsy-custom-plugins/scripts/stage-desktop-trial-plugins.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_MOBILE_SPEC, T4Y_PLUGIN_NAMES } from './enterprise-desktop-plugins.mjs'

const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pluginsRoot, '..')
const desktopRoot = path.join(repoRoot, 'apps/desktop')
const output = path.join(desktopRoot, '.desktop-build/trial-plugins')
const mobileFetchRoot = path.join(desktopRoot, '.desktop-build/dsh-mobile-fetch')
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

/**
 * Copy package files into the trial stage directory.
 * Literal `files` entries are copied as-is. Glob entries (npm `files` patterns) are not
 * filesystem paths — for those, copy the installed package tree except node_modules/.git
 * (an npm-installed package is already the published set, including Host `main`).
 * @param {string} source
 * @param {string} target
 * @param {string[]} files
 */
function copyPublishedTree(source, target, files) {
  const hasGlob = files.some((entry) => /[*?[\]{}]/u.test(entry))
  if (files.length > 0 && !hasGlob) {
    for (const entry of files) {
      const from = path.join(source, entry)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(target, entry), { recursive: true, dereference: true })
    }
    return
  }
  for (const entry of fs.readdirSync(source)) {
    if (entry === 'node_modules' || entry === '.git') continue
    fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true, dereference: true })
  }
}

/**
 * Stage one package directory into trial-plugins.
 * @param {string} source
 * @param {string} targetName
 */
function stagePackage(source, targetName) {
  const target = path.join(output, targetName)
  const manifest = readJson(path.join(source, 'package.json'))
  fs.mkdirSync(target, { recursive: true })
  const entries = Array.isArray(manifest.files) ? manifest.files : []
  copyPublishedTree(source, target, entries)
  const { scripts: _scripts, devDependencies: _dev, ...published } = manifest
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(published, undefined, 2)}\n`)
  const main = typeof published.main === 'string' && published.main !== '' ? published.main : 'index.js'
  if (!fs.existsSync(path.join(target, main))) {
    throw new Error(`stage: ${manifest.name} missing main entry ${main} after copy`)
  }
  // Literal `files` entries must land; a missing sibling (e.g. per-host-origin.js)
  // otherwise ships a Host that fails on import.
  for (const entry of entries) {
    if (/[*?[\]{}]/u.test(entry)) continue
    if (!fs.existsSync(path.join(target, entry))) {
      throw new Error(`stage: ${manifest.name} missing published file ${entry} after copy`)
    }
  }
  copyDependencies(source, path.join(target, 'node_modules'), new Set())
  console.log(`staged ${manifest.name}@${manifest.version}`)
}

/**
 * Ensure a local install of dsh-mobile@DSH_MOBILE_SPEC and return its package directory.
 * @returns {string}
 */
function ensureDshMobileSource() {
  const preferred = [
    path.join(repoRoot, 'apps/desktop/.desktop-build/development/home/profiles/desktop/node_modules/dsh-mobile'),
    path.join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/dsh-mobile'),
    path.join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/dsh-mobile'),
  ]
  for (const candidate of preferred) {
    if (!candidate || !fs.existsSync(path.join(candidate, 'package.json'))) continue
    const version = readJson(path.join(candidate, 'package.json')).version
    if (version === DSH_MOBILE_SPEC) return fs.realpathSync(candidate)
  }

  fs.rmSync(mobileFetchRoot, { recursive: true, force: true })
  fs.mkdirSync(mobileFetchRoot, { recursive: true })
  fs.writeFileSync(path.join(mobileFetchRoot, 'package.json'), `${JSON.stringify({
    name: 'dsh-mobile-fetch',
    private: true,
    dependencies: { 'dsh-mobile': DSH_MOBILE_SPEC },
  }, null, 2)}\n`)
  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: mobileFetchRoot,
    stdio: 'inherit',
    shell: true,
  })
  const installed = path.join(mobileFetchRoot, 'node_modules', 'dsh-mobile')
  if (!fs.existsSync(path.join(installed, 'package.json'))) {
    throw new Error(`stage: failed to fetch dsh-mobile@${DSH_MOBILE_SPEC}`)
  }
  return fs.realpathSync(installed)
}

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
// Omit the development bootstrap manifest from the installer. With no manifest,
// Desktop seeds each carried package through its local `file:` path rather than
// persisting a Git release reference for an initial plugin.
for (const plugin of T4Y_PLUGIN_NAMES) {
  stagePackage(path.join(pluginsRoot, plugin), plugin)
}
stagePackage(ensureDshMobileSource(), 'dsh-mobile')

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

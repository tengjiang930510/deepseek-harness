/** Prepare checkout-owned bundles and private dotenv defaults for Windows installers. */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { valid } from 'semver'
import { z } from 'zod'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { discoverCustomPlugins } from '../../../scripts/custom-plugins.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const manifestSchema = z.object({
  name: z.string(), version: z.string(), files: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
}).passthrough()

const packageName = z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u)

function configuredPackages(root: string): string[] {
  const file = join(root, 'apps', 'desktop', 'packaged-plugins.json')
  if (!existsSync(file)) return []
  return z.object({ packages: z.array(packageName) }).parse(JSON.parse(readFileSync(file, 'utf8'))).packages
}

function packagedPlugins(root: string, installedDirectory: string) {
  const plugins = discoverCustomPlugins(root).map(plugin => ({ ...plugin, installed: false }))
  const names = new Set(plugins.map(plugin => plugin.name))
  for (const name of configuredPackages(root)) {
    if (names.has(name)) throw new Error(`desktop source resources: duplicate packaged bundle ${name}`)
    const candidate = join(installedDirectory, 'node_modules', name)
    if (!existsSync(join(candidate, 'package.json'))) throw new Error(`desktop source resources: packaged bundle ${name} is missing after download`)
    const directory = realpathSync(candidate)
    const manifest = manifestSchema.extend({
      dsh: z.object({ bundle: z.object({ patch: z.union([z.string(), z.array(z.string())]) }) }),
    }).parse(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
    if (manifest.name !== name) throw new Error(`desktop source resources: expected ${name}, found ${manifest.name}`)
    plugins.push({ name, directory, dependencies: manifest.dependencies ?? {}, build: false, installed: true })
    names.add(name)
  }
  return plugins
}

/**
 * Resolve each selected npm bundle's latest tag into a fresh, isolated installation for this build.
 * Lifecycle scripts and automatic peer installation are disabled; failure never falls back to an older copy.
 * @param root - Checkout owning the selected package names and ignored download workspace.
 * @returns Prepared dependency directory and a disposer that removes only this run's installation.
 * @throws When npm resolution or installation fails; the caller must not produce an installer.
 */
export function prepareLatestPackagedPlugins(root: string): { directory: string; dispose(): void } {
  const packages = configuredPackages(root)
  const parent = join(root, 'apps/desktop/.desktop-build/packaged-plugin-downloads')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'build-'))
  const dispose = () => { rmSync(directory, { recursive: true, force: true }) }
  try {
    const dependencies: Record<string, string> = {}
    for (const name of packages) {
      const lookup = pnpmInvocation(['view', `${name}@latest`, 'version', '--json', '--config.prefer-online=true'])
      const result = spawnSync(lookup.command, lookup.args, { cwd: directory, encoding: 'utf8' })
      if (result.error !== undefined) throw result.error
      if (result.status !== 0) throw new Error(`desktop source resources: latest version lookup failed for ${name}; packaging stopped`)
      let version: unknown
      try { version = JSON.parse(result.stdout) }
      catch (error) {
        // Registry output may contain authentication diagnostics; never echo it as a version.
        if (!(error instanceof SyntaxError)) throw error
        throw new Error(`desktop source resources: invalid latest version response for ${name}`)
      }
      if (typeof version !== 'string' || valid(version) === null) {
        throw new Error(`desktop source resources: invalid latest version for ${name}`)
      }
      dependencies[name] = version
    }
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
      private: true, dependencies,
    }, null, 2)}\n`)
    if (packages.length > 0) {
      const invocation = pnpmInvocation(['install', '--ignore-workspace', '--ignore-scripts',
        '--config.auto-install-peers=false', '--lockfile=false'])
      const result = spawnSync(invocation.command, invocation.args, { cwd: directory, stdio: 'inherit' })
      if (result.error !== undefined) throw result.error
      if (result.status !== 0) {
        throw new Error(`desktop source resources: latest npm bundle download failed (${String(result.status ?? result.signal)}); packaging stopped`)
      }
    }
    return { directory, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

function findPackage(directory: string, name: string): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(current) === current) return undefined
  }
}

function copyInstalledPackage(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true, dereference: true,
    filter: path => path === source || !path.slice(source.length + 1).split(/[/\\]/u).includes('node_modules'),
  })
}

function copyDependencies(directory: string, destination: string, copied: Map<string, string>): void {
  const manifest = z.object({
    dependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
  }).parse(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}))
  for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...optional])) {
    const source = findPackage(directory, name)
    if (source === undefined) {
      if (optional.has(name)) continue
      throw new Error(`desktop source resources: missing dependency ${name} in ${directory}; run pnpm run build`)
    }
    const previous = copied.get(name)
    if (previous !== undefined) {
      if (previous !== source) throw new Error(`desktop source resources: conflicting installed versions of ${name}`)
      continue
    }
    copied.set(name, source)
    copyInstalledPackage(source, join(destination, name))
    copyDependencies(source, destination, copied)
  }
}

/**
 * Replace Windows resources with checkout bundles, configured installed bundles, and optional root dotenv.
 * Production dependencies are copied as files, so installed plugins do not depend on checkout links.
 * @param root - Checkout root whose custom plugin dependencies and build outputs are prepared.
 * @param installedDirectory - Prepared directory holding the selected npm bundles in node_modules.
 * @returns Names of bundles included in the installer resource directory.
 * @throws On invalid metadata, missing published files, or missing or conflicting production dependencies.
 */
export function stageDesktopSourceResources(root: string, installedDirectory = join(root, 'apps', 'desktop')): string[] {
  const output = resolve(root, 'apps/desktop/.desktop-build/source-resources')
  const plugins = packagedPlugins(root, installedDirectory)
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const dotenv = join(root, '.env')
  if (existsSync(dotenv)) {
    writeFileSync(join(output, 'runtime-defaults.env'), readFileSync(dotenv), { mode: 0o600 })
  }
  for (const plugin of plugins) {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(plugin.directory, 'package.json'), 'utf8')))
    const target = join(output, 'plugins', ...plugin.name.split('/'))
    // Resource children are one bundle each, including scoped package names.
    const destination = plugin.name.startsWith('@') ? join(output, 'plugins', plugin.name.replace('/', '__')) : target
    mkdirSync(destination, { recursive: true })
    if (plugin.installed) copyInstalledPackage(plugin.directory, destination)
    for (const file of plugin.installed ? [] : z.array(z.string()).parse(manifest.files)) {
      const source = resolve(plugin.directory, file)
      if (!source.startsWith(`${resolve(plugin.directory)}/`) && !source.startsWith(`${resolve(plugin.directory)}\\`)) {
        throw new Error(`desktop source resources: published file ${file} escapes ${plugin.name}`)
      }
      if (!existsSync(source)) throw new Error(`desktop source resources: ${plugin.name} is missing ${file}; run pnpm run build`)
      cpSync(source, join(destination, file), { recursive: true, dereference: true })
    }
    const { scripts: _scripts, devDependencies: _development, ...published } = manifest
    writeFileSync(join(destination, 'package.json'), `${JSON.stringify(published, null, 2)}\n`)
    copyDependencies(plugin.directory, join(destination, 'node_modules'), new Map())
  }
  writeFileSync(join(output, 'packaged-plugins.json'), `${JSON.stringify(plugins.map((plugin) => {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(plugin.directory, 'package.json'), 'utf8')))
    return { name: manifest.name, version: manifest.version }
  }), null, 2)}\n`)
  return plugins.map(plugin => plugin.name)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } })
  const root = resolve(values.root ?? process.cwd())
  // Validate through the same dotenv policy as the installed Host before copying private values.
  loadLayeredEnv('desktop source resources', root)
  const installation = prepareLatestPackagedPlugins(root)
  try {
    const plugins = stageDesktopSourceResources(root, installation.directory)
    for (const name of configuredPackages(root)) {
      const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(installation.directory, 'node_modules', name, 'package.json'), 'utf8')))
      console.log(`desktop source resources: resolved ${name}@${manifest.version}`)
    }
    console.log(`desktop source resources: staged ${plugins.length} custom bundles; dotenv ${existsSync(join(root, '.env')) ? 'included' : 'absent'}`)
  } finally {
    installation.dispose()
  }
}

/** Prepare checkout-owned plugin bundles and register them in the source Web profile. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runPlugin } from '../apps/cli/src/plugin.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

const manifestSchema = z.object({
  name: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/),
  dependencies: z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dsh: z.object({ bundle: z.object({ patch: z.union([z.string(), z.array(z.string())]) }).optional() }).optional(),
})
const markerSchema = z.object({ packages: z.array(z.string()) })

/** One local package contributing a Cordis bundle. */
export interface CustomPlugin {
  readonly name: string
  readonly directory: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly build: boolean
}

/**
 * Discover bundle packages immediately below the checkout's custom plugin directory.
 * @param root - Checkout root; a missing custom directory contributes no bundles.
 * @returns Packages in directory-name order, with duplicate package names rejected.
 */
export function discoverCustomPlugins(root: string): CustomPlugin[] {
  const directory = join(root, 'tsy-custom-plugins')
  if (!existsSync(directory)) return []
  const plugins: CustomPlugin[] = []
  const names = new Set<string>()
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const packageDir = join(directory, entry.name)
    const file = join(packageDir, 'package.json')
    if (!existsSync(file)) continue
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    if (manifest.dsh?.bundle === undefined) continue
    if (names.has(manifest.name)) throw new Error(`custom plugins: duplicate package ${manifest.name} in ${file}`)
    names.add(manifest.name)
    const patches = manifest.dsh.bundle.patch
    for (const patch of typeof patches === 'string' ? [patches] : patches) {
      if (!existsSync(resolve(packageDir, patch))) throw new Error(`custom plugins: missing patch ${patch} in ${packageDir}`)
    }
    plugins.push({
      name: manifest.name,
      directory: packageDir,
      dependencies: manifest.dependencies ?? {},
      build: manifest.scripts?.build !== undefined,
    })
  }
  return plugins
}

function runPnpm(args: readonly string[], cwd: string): void {
  const invocation = pnpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`custom plugins: pnpm ${args.join(' ')} failed in ${cwd} (${String(result.status ?? result.signal)})`)
}

/**
 * Install local dependencies without lifecycle scripts, then run declared build scripts.
 * @param root - Checkout root containing trusted custom plugin sources.
 * @returns After every discovered bundle has its dependencies and build outputs prepared.
 * @throws On invalid metadata or a failed install/build; the application must not start after failure.
 */
export function prepareCustomPlugins(root: string): void {
  for (const plugin of discoverCustomPlugins(root)) {
    console.log(`custom plugins: preparing ${plugin.name}`)
    if (Object.keys(plugin.dependencies).length > 0 || plugin.build) {
      runPnpm(['install', '--ignore-workspace', '--ignore-scripts', '--config.auto-install-peers=false', '--lockfile=false'], plugin.directory)
    }
    if (plugin.build) runPnpm(['run', 'build'], plugin.directory)
  }
}

/** Registration inputs; isolated callers can supply their own profile and package operation. */
export interface CustomPluginRegistration {
  readonly profileDir: string
  /** Adds link specs through the profile's ordinary package manager; rejects on failure. */
  readonly install: (specs: readonly string[]) => Promise<void>
}

/**
 * Register new source bundles once and repair retained links after relocation.
 * User deselections and removals survive subsequent starts. Registry-installed copies remain user-owned.
 * @param root - Checkout root supplying bundle packages.
 * @param options - Profile directory and installation operation.
 * @returns After installation and the registration marker have been saved under a per-profile lock.
 * @throws On invalid metadata, missing prepared dependencies, installation failure, or marker write failure.
 */
export async function registerCustomPlugins(root: string, options: CustomPluginRegistration): Promise<void> {
  const plugins = discoverCustomPlugins(root)
  if (plugins.length === 0) return
  await mkdir(options.profileDir, { recursive: true })
  const marker = join(options.profileDir, 'source-plugins.json')
  await withFileLock(marker, async () => {
    const seen = new Set(existsSync(marker) ? markerSchema.parse(JSON.parse(readFileSync(marker, 'utf8'))).packages : [])
    const profileFile = join(options.profileDir, 'package.json')
    const profile = existsSync(profileFile)
      ? z.object({ dependencies: z.record(z.string(), z.string()).optional() }).parse(JSON.parse(readFileSync(profileFile, 'utf8')))
      : { dependencies: {} }
    const specs: string[] = []
    for (const plugin of plugins) {
      const previous = profile.dependencies?.[plugin.name]
      if (previous === undefined && seen.has(plugin.name)) continue
      if (previous !== undefined && !/^(?:link|file):/.test(previous)) continue
      for (const dependency of Object.keys(plugin.dependencies)) {
        if (!existsSync(join(plugin.directory, 'node_modules', dependency, 'package.json'))) {
          throw new Error(`custom plugins: ${plugin.name} needs ${dependency}; run pnpm run build before pnpm dsh web`)
        }
      }
      const target = join(options.profileDir, 'node_modules', plugin.name)
      const sameLink = previous?.startsWith('link:') === true
        && resolve(options.profileDir, previous.slice('link:'.length)) === resolve(plugin.directory)
      if (!sameLink || !existsSync(target) || realpathSync(target) !== realpathSync(plugin.directory)) {
        specs.push(`link:${plugin.directory}`)
      }
      seen.add(plugin.name)
    }
    if (specs.length > 0) await options.install(specs)
    await writeFileAtomic(marker, `${JSON.stringify({ packages: [...seen].sort() }, null, 2)}\n`, { mode: 0o600 })
  }, { waitMs: 120000 })
}

/**
 * Register checkout-owned bundles through the official Web profile package operations.
 * @param root - Checkout root whose sources are being launched.
 * @returns After the current Harness home's Web profile is ready to load.
 */
export async function registerSourceWebPlugins(root: string): Promise<void> {
  await registerCustomPlugins(root, {
    profileDir: resolveProfileDir('web'),
    async install(specs) {
      console.log('custom plugins: registering source bundles in the Web profile')
      const invocation = pnpmInvocation([])
      const result = await runPlugin('web', ['add', ...specs], { command: invocation.command, args: invocation.args, env: {} })
      if (result !== 0) throw new Error('custom plugins: Web profile registration failed; fix the package-manager error and restart pnpm dsh web')
    },
  })
}

if (import.meta.main) prepareCustomPlugins(resolve(import.meta.dirname, '..'))

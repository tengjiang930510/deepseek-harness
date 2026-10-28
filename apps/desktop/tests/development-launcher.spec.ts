import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it.each(['dev', 'start'])('%s resolves the shared source registrar from the Desktop working directory', (script) => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-launcher-resolution-'))
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }
    const command = manifest.scripts[script]!.split(' ')
    const entry = command.indexOf('scripts/dev.ts')
    expect(entry).toBeGreaterThan(0)
    const runner = join(directory, 'registrar.mjs')
    writeFileSync(runner, `
      import { discoverCustomPlugins } from ${JSON.stringify(new URL('../../../scripts/custom-plugins.ts', import.meta.url).href)}
      console.log(JSON.stringify(discoverCustomPlugins(${JSON.stringify(directory)})))
    `)
    const inherited = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => name.toUpperCase() !== 'TSX_TSCONFIG_PATH'))
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('tsx/cli')),
      ...command.slice(1, entry), runner], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: inherited, encoding: 'utf8', timeout: 30_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('[]')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('starts the build before loading helpers that require workspace artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-launcher-'))
  try {
    const hook = join(directory, 'unbuilt-workspace.mjs')
    const packageManager = join(directory, 'package-manager.mjs')
    writeFileSync(hook, `
      import { registerHooks } from 'node:module'
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (context.parentURL?.endsWith('/scripts/dev.ts')
          && ['./development-project.ts', './prepare-primary-runtime.ts', './source-plugins.ts'].includes(specifier)) {
          throw new Error('workspace artifacts are unavailable before the build')
        }
        return nextResolve(specifier, context)
      } })
    `)
    writeFileSync(packageManager, `
      import ${JSON.stringify(import.meta.resolve('tsx/esm'))}
      console.log(process.argv.slice(2).join(' ')); process.exitCode = 1
    `)
    // Windows can retain an uppercase lifecycle variable alongside a lowercase override passed to spawn.
    const inheritedEnvironment = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !['npm_execpath', 'tsx_tsconfig_path'].includes(name.toLowerCase())))
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, fileURLToPath(import.meta.resolve('tsx/cli')),
      '--tsconfig', '../../tsconfig.json', 'scripts/dev.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8', timeout: 30_000, env: { ...inheritedEnvironment, npm_execpath: packageManager },
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stdout.trim()).toBe('run build:artifacts')
    expect(result.stderr).toContain(`desktop development: ${packageManager} run build:artifacts exited with 1`)
    expect(result.stderr).not.toContain('workspace artifacts are unavailable')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

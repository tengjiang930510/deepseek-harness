import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it('starts the build before loading helpers that require workspace artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-launcher-'))
  try {
    const hook = join(directory, 'unbuilt-workspace.mjs')
    const packageManager = join(directory, 'package-manager.mjs')
    writeFileSync(hook, `
      import { registerHooks } from 'node:module'
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (context.parentURL?.endsWith('/scripts/dev.ts')
          && ['./development-project.ts', './prepare-primary-runtime.ts'].includes(specifier)) {
          throw new Error('workspace artifacts are unavailable before the build')
        }
        return nextResolve(specifier, context)
      } })
    `)
    writeFileSync(packageManager, "console.log(process.argv.slice(2).join(' ')); process.exitCode = 1\n")
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, '--import', 'tsx/esm',
      fileURLToPath(new URL('../scripts/dev.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, npm_execpath: packageManager },
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

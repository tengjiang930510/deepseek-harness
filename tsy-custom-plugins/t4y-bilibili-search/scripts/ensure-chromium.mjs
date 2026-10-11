/**
 * Install Playwright Chromium when missing. Skipped when
 * T4Y_BILIBILI_SKIP_BROWSER_INSTALL=1 (CI / offline).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.env.T4Y_BILIBILI_SKIP_BROWSER_INSTALL === '1') {
  process.exit(0)
}

const require = createRequire(import.meta.url)
let cli
try {
  const pkg = dirname(require.resolve('playwright/package.json'))
  cli = join(pkg, 'cli.js')
  if (!existsSync(cli)) throw new Error(`missing ${cli}`)
} catch (error) {
  process.stderr.write(`[t4y-bilibili-search] playwright not installed; skip browser download (${error instanceof Error ? error.message : error})\n`)
  process.exit(0)
}

const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)

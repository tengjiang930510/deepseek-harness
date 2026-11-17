/** Run the checkout's Vitest without installing a second test or Harness runtime. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const args = process.argv.slice(2)
const live = args.includes('--live')
const ui = args.includes('--ui')
if (live && ui) throw new Error('Choose either --live or --ui')
const result = spawnSync(process.execPath, [
  resolve(repo, 'node_modules/vitest/vitest.mjs'), 'run',
  '--config', resolve(repo, `tsy-custom-plugins/t4y-openai-service/vitest${ui ? '.ui' : ''}.config.ts`),
  ...args.filter(arg => arg !== '--live' && arg !== '--ui'),
], {
  cwd: repo,
  env: { ...process.env, T4Y_OPENAI_TEST_LIVE: live ? '1' : '0' },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? (result.signal === 'SIGINT' ? 130 : 1)

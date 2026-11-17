/** Host-backed source tests and isolated public-profile replay for this custom bundle. */
import { resolve } from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

const repo = resolve(import.meta.dirname, '../..')
const live = process.env.T4Y_OPENAI_TEST_LIVE === '1'
if (live) {
  try { process.loadEnvFile(resolve(repo, '.env')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export default defineConfig({
  root: repo,
  plugins: [tsconfigPaths({ projects: [resolve(repo, 'tsconfig.base.json')] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: [resolve(repo, 'scripts/test-proxy-environment.ts')],
    include: [
      'tsy-custom-plugins/t4y-openai-service/tests/**/*.spec.ts',
      ...(live ? ['tsy-custom-plugins/t4y-openai-service/tests/**/*.e2e.ts'] : []),
    ],
    exclude: ['tsy-custom-plugins/t4y-openai-service/tests/ui/**'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
  },
})

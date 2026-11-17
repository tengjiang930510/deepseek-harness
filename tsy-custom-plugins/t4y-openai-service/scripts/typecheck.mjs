/** Check this plugin against the checkout's Host source graph and current declaration artifacts. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const repo = resolve(root, '../..')
const host = ts.parseConfigFileTextToJson('tsconfig.host.json', readFileSync(resolve(repo, 'tsconfig.host.json'), 'utf8'))
if (host.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(host.error.messageText, '\n'))
const filename = resolve(root, `.typecheck-${process.pid}.json`)
writeFileSync(filename, JSON.stringify({
  extends: resolve(repo, 'tsconfig.host.json'),
  compilerOptions: { composite: false, incremental: false, noEmit: true },
  include: [...host.config.include.map(path => resolve(repo, path)), resolve(root, 'src/**/*.ts'), resolve(root, 'tests/**/*.ts')],
  references: host.config.references.map(ref => ({ path: resolve(repo, ref.path) })),
}))
try {
  const result = spawnSync(process.execPath, ['--max-old-space-size=8192', resolve(root, 'node_modules/typescript/lib/tsc.js'), '--project', filename], { cwd: repo, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  process.exitCode = result.status ?? 1
} finally { rmSync(filename) }

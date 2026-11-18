/** Build the private service while leaving Harness peers owned by the installation. */
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
await rm(new URL('../lib/', import.meta.url), { recursive: true, force: true })
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({
  absWorkingDir: root, entryPoints: ['src/index.ts', 'src/app.ts', 'src/file-delivery.ts'], outdir: 'lib',
  bundle: true, splitting: true, packages: 'external', external: ['@deepseek-ai/*'], platform: 'node', format: 'esm', target: 'node24', sourcemap: true,
})

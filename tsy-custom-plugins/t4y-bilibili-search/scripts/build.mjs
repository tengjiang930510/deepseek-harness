import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(root, 'lib'), { recursive: true })
await build({
  entryPoints: [join(root, 'src/bilibili-video-search.ts')],
  outfile: join(root, 'lib/search.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
})

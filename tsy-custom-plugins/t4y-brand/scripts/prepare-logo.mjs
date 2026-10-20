/**
 * Trim and downscale a source logo into the embedded brand assets.
 * Usage: node prepare-logo.mjs <source.png>
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(pluginRoot, '../..')
const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm')
const sharpDir = fs.readdirSync(pnpmDir).find(name => name.startsWith('sharp@'))
if (sharpDir === undefined) throw new Error('sharp is not installed in the workspace')
const require = createRequire(pathToFileURL(path.join(pnpmDir, sharpDir, 'node_modules/sharp/package.json')))
const sharp = require('sharp')

const source = process.argv[2]
if (source === undefined) throw new Error('usage: node prepare-logo.mjs <source.png>')

const assets = path.join(pluginRoot, 'assets')
fs.mkdirSync(assets, { recursive: true })
const name = path.basename(source, path.extname(source))
fs.copyFileSync(source, path.join(assets, `${name}.png`))

const png = await sharp(source)
  .trim()
  .resize({ width: 128, height: 128, fit: 'inside' })
  .png({ compressionLevel: 9 })
  .toBuffer()
fs.writeFileSync(path.join(assets, 'brand-mark.png'), png)
fs.writeFileSync(path.join(assets, 'data-url.txt'), `data:image/png;base64,${png.toString('base64')}`)

const chatDir = path.join(repoRoot, 'packages/client/ui-chat/src/client/chat')
fs.writeFileSync(path.join(chatDir, 'running-brand.png'), png)
fs.writeFileSync(
  path.join(chatDir, 'running-brand-data.ts'),
  `/** Embedded brand mark for the Chat running-status row. */\nexport const RUNNING_BRAND_MARK_SRC = ${JSON.stringify(`data:image/png;base64,${png.toString('base64')}`)}\n`,
)

const meta = await sharp(png).metadata()
console.log(`brand-mark.png ${meta.width}x${meta.height}, ${png.length} bytes`)

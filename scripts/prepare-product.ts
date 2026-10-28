/** Generate branch-owned Web and Desktop brand assets without rewriting source files. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises'
import sharp from 'sharp'
import { join, resolve } from 'node:path'
import { packIco, TRAY_ICON_SIZES } from '../apps/desktop/scripts/render-tray-icon.ts'
import { PRODUCT_ROOT, readProductConfig } from './product-config.ts'


/**
 * Generate all brand assets, publishing only after every image decodes and renders.
 * @param root - Checkout or isolated fixture root containing product-config/product.yml.
 * @returns after the complete asset directory has been published; failures stop dependent builds.
 */
export async function prepareProduct(root = PRODUCT_ROOT): Promise<void> {
  const product = readProductConfig(root)
  await sharp(product.logo).metadata()
  if (product.appIcon !== undefined) await sharp(product.appIcon).metadata()
  const parent = join(root, '.dsh-build')
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, 'product-'))
  try {
    const logo = await sharp(product.logo).resize(256, 256, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const icon = product.appIcon === undefined
      ? await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } })
        .composite([{ input: await sharp(product.logo).resize(768, 768, { fit: 'contain', background: '#ffffff00' }).png().toBuffer(), gravity: 'centre' }]).png().toBuffer()
      : await sharp(product.appIcon).resize(1024, 1024, { fit: 'contain', background: '#ffffff00' }).png().toBuffer()
    const logoName = `logo-${product.fingerprint.slice(0, 16)}.png`
    await writeFile(join(temporary, logoName), logo)
    await writeFile(join(temporary, 'app-icon.png'), icon)
    if (process.platform === 'darwin') {
      const iconset = join(temporary, 'app.iconset')
      await mkdir(iconset)
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) await sharp(icon).resize(size * scale, size * scale).png()
          .toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`))
      }
      await promisify(execFile)('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(temporary, 'app-icon.icns')])
      await rm(iconset, { recursive: true })
    }
    for (const size of [32, 192, 512]) await sharp(icon).resize(size, size).png().toFile(join(temporary, `icon-${size}.png`))
    // Maskable icons retain safe inset even when the supplied application artwork fills its canvas.
    await sharp({ create: { width: 512, height: 512, channels: 4, background: '#ffffff' } })
      .composite([{ input: await sharp(icon).resize(360, 360).png().toBuffer(), gravity: 'centre' }]).png().toFile(join(temporary, 'icon-maskable-512.png'))
    const bitmaps = await Promise.all(TRAY_ICON_SIZES.map(async size => ({
      size, png: await sharp(icon).resize(size, size).png().toBuffer(),
    })))
    await writeFile(join(temporary, 'tray.ico'), packIco(bitmaps))
    const xml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
    for (const [name, scale, ink] of [['brand', 1, '#1c2434'], ['brand-2x', 2, '#1c2434'], ['brand-dark', 1, '#f5f6f8'], ['brand-dark-2x', 2, '#f5f6f8']] as const) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${600 * scale}" height="${196 * scale}" viewBox="0 0 600 196"><image href="data:image/png;base64,${logo.toString('base64')}" x="234" y="8" width="132" height="104" preserveAspectRatio="xMidYMid meet"/><text x="300" y="166" text-anchor="middle" font-family="sans-serif" font-size="30" textLength="${Math.min(540, product.name.length * 30)}" lengthAdjust="spacingAndGlyphs" fill="${ink}">${xml(product.name)}</text></svg>`
      await sharp(Buffer.from(svg)).png().toFile(join(temporary, `${name}.png`))
    }
    await sharp({ create: { width: 164, height: 314, channels: 4, background: '#f5f6f8' } })
      .composite([{ input: await sharp(product.logo).resize(120, 120, { fit: 'contain', background: '#ffffff00' }).png().toBuffer(), gravity: 'centre' }]).png().toFile(join(temporary, 'uninstaller-sidebar.png'))
    await writeFile(join(temporary, 'brand.json'), JSON.stringify({ name: product.name, fingerprint: product.fingerprint, logo: logoName }) + '\n')
    const destination = join(parent, 'product')
    await rm(destination, { recursive: true, force: true })
    await rename(temporary, destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await prepareProduct()

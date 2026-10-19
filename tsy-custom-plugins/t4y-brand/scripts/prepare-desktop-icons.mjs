/**
 * Replace the Desktop application, tray, and installer artwork with the brand logo.
 * Usage: node prepare-desktop-icons.mjs [source.png]
 * Afterwards run `pnpm run render:tray-icon` in `apps/desktop`.
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

const BRAND_NAME = '武汉地铁智能助手'
const source = process.argv[2] ?? path.join(pluginRoot, 'assets/wuhanmetro-mark-transparent.png')
const desktop = path.join(repoRoot, 'apps/desktop')
const resources = path.join(desktop, 'resources')
const installerAssets = path.join(desktop, 'installer/assets')

const logo = await sharp(source).trim().resize({ width: 800, height: 800, fit: 'inside' }).png().toBuffer()
const { width: logoWidth, height: logoHeight } = await sharp(logo).metadata()
const logoHref = `data:image/png;base64,${logo.toString('base64')}`

/** Fit the logo into a box centered at (cx, cy) and return SVG `<image>` markup. */
function logoImage(cx, cy, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / logoWidth, maxHeight / logoHeight)
  const w = logoWidth * scale
  const h = logoHeight * scale
  return `<image href="${logoHref}" x="${(cx - w / 2).toFixed(2)}" y="${(cy - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/>`
}

// The tile keeps the original Windows icon background; the tray renderer scales `tray-glyph` around (552, 544).
const iconSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(32 32) scale(0.9375) translate(-40 -32)"><g filter="url(#tile-shadow)">
<rect rx="192" width="1024" height="1024" transform="translate(40 32)" fill="#FBFBFB"/>
<rect rx="192" width="1024" height="1024" transform="translate(40 32)" fill="url(#tile-gradient-a)" fill-opacity="0.4"/>
<rect rx="192" width="1024" height="1024" transform="translate(40 32)" fill="url(#tile-gradient-b)" fill-opacity="0.8"/>
<g id="tray-glyph">
${logoImage(552, 544, 700, 640)}
</g>
</g>
</g>
<defs>
<filter id="tile-shadow" x="-8" y="-16" width="1120" height="1120" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="8"/>
<feGaussianBlur stdDeviation="20"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape"/>
</filter>
<linearGradient id="tile-gradient-a" x1="973.58" y1="0" x2="378.123" y2="917.86" gradientUnits="userSpaceOnUse">
<stop offset="0.141617" stop-color="#D4DBE9"/>
<stop offset="0.485965" stop-color="#FBFBFB"/>
</linearGradient>
<linearGradient id="tile-gradient-b" x1="603.371" y1="445.063" x2="239.356" y2="1111.41" gradientUnits="userSpaceOnUse">
<stop offset="0.363044" stop-color="#FBFBFB"/>
<stop offset="0.83031" stop-color="#E1E6EE"/>
</linearGradient>
</defs>
</svg>
`
fs.writeFileSync(path.join(resources, 'icon-windows.svg'), iconSvg)
await sharp(Buffer.from(iconSvg)).resize(1024, 1024).png().toFile(path.join(resources, 'icon-windows.png'))

/** Installer header: logo above the product name on a transparent background. */
function brandSvg(scale, textColor) {
  const w = 600 * scale
  const h = 196 * scale
  return `<svg width="${w}" height="${h}" viewBox="0 0 600 196" xmlns="http://www.w3.org/2000/svg">
${logoImage(300, 66, 132, 104)}
<text x="300" y="168" text-anchor="middle" font-family="Microsoft YaHei, Microsoft YaHei UI, SimHei, sans-serif" font-size="30" font-weight="700" fill="${textColor}">${BRAND_NAME}</text>
</svg>`
}
for (const [name, scale, color] of [
  ['brand', 1, '#1C2434'],
  ['brand-2x', 2, '#1C2434'],
  ['brand-dark', 1, '#F5F6F8'],
  ['brand-dark-2x', 2, '#F5F6F8'],
]) {
  await sharp(Buffer.from(brandSvg(scale, color))).png().toFile(path.join(installerAssets, `${name}.png`))
}

const sidebarSvg = `<svg width="164" height="314" viewBox="0 0 164 314" xmlns="http://www.w3.org/2000/svg">
<rect width="164" height="314" fill="#F5F6F8"/>
<rect x="22" y="90" width="120" height="120" rx="6" fill="#FFFFFF"/>
${logoImage(82, 150, 92, 80)}
</svg>`
await sharp(Buffer.from(sidebarSvg)).png().toFile(path.join(installerAssets, 'uninstaller-sidebar.png'))

console.log('wrote icon-windows.svg/png and installer brand assets')

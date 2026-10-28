import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { expect, it, onTestFinished } from 'vitest'
import { readProductConfig, requireProductBuild } from './product-config.ts'
import { prepareProduct } from './prepare-product.ts'
import { unpackIco } from '../apps/desktop/scripts/render-tray-icon.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'product config 中文 '))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'product-config')
  await mkdir(join(directory, 'product-assets'), { recursive: true })
  const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer()
  await writeFile(join(directory, 'product-assets/logo.png'), png)
  const config = join(directory, 'product.yml')
  await writeFile(config, 'name: 测试助手\nlogo: ./product-assets/logo.png\n')
  return { root, directory, config, output: join(root, '.dsh-build/product'), png }
}

it('resolves assets beside the configuration and rejects obsolete generated resources', async () => {
  const f = await fixture()
  expect(readProductConfig(f.root).name).toBe('测试助手')
  expect(() => requireProductBuild(f.root)).toThrow('run pnpm run build')
  await prepareProduct(f.root)
  const first = requireProductBuild(f.root)
  expect(first.name).toBe('测试助手')
  expect((await sharp(await readFile(join(f.output, 'app-icon.png'))).metadata()).width).toBe(1024)
  expect(unpackIco(await readFile(join(f.output, 'tray.ico'))).map(entry => entry.size)).toEqual([16, 20, 24, 32, 40, 48, 64])
  await writeFile(f.config, 'name: 第二个产品\nlogo: ./product-assets/logo.png\n')
  expect(() => requireProductBuild(f.root)).toThrow('stale')
  await prepareProduct(f.root)
  const next = requireProductBuild(f.root)
  expect(next.name).toBe('第二个产品')
  expect(next.logo).not.toBe(first.logo)
  await expect(readFile(join(f.output, first.logo))).rejects.toThrow()
})

it('uses separate application artwork and invalidates the build when image bytes change', async () => {
  const f = await fixture()
  const blue = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#0000ff' } }).png().toBuffer()
  const appIcon = join(f.directory, 'product-assets/app.png')
  await writeFile(appIcon, blue)
  await writeFile(f.config, 'name: Test $& Product\nlogo: ./product-assets/logo.png\nappIcon: ./product-assets/app.png\n')
  await prepareProduct(f.root)
  const pixel = await sharp(await readFile(join(f.output, 'app-icon.png'))).extract({ left: 512, top: 512, width: 1, height: 1 }).raw().toBuffer()
  expect([...pixel]).toEqual([0, 0, 255, 255])
  const previous = requireProductBuild(f.root)
  await writeFile(appIcon, f.png)
  expect(() => requireProductBuild(f.root)).toThrow('stale')
  await prepareProduct(f.root)
  expect(requireProductBuild(f.root).fingerprint).not.toBe(previous.fingerprint)
})

it.each([
  'name: ""\nlogo: ./product-assets/logo.png',
  'name: Test\nlogo: ./missing.png',
  'name: Test\nlogo: ./product-assets/logo.png\nextra: value',
])('rejects invalid product configuration: %s', async (config) => {
  const f = await fixture()
  await writeFile(f.config, config)
  expect(() => readProductConfig(f.root)).toThrow()
})

it('rejects malformed images before replacing a complete build', async () => {
  const f = await fixture()
  await prepareProduct(f.root)
  const previous = await readFile(join(f.output, 'brand.json'), 'utf8')
  await writeFile(join(f.directory, 'product-assets/logo.png'), f.png.subarray(0, 16))
  await expect(prepareProduct(f.root)).rejects.toThrow()
  expect(await readFile(join(f.output, 'brand.json'), 'utf8')).toBe(previous)
  await writeFile(join(f.directory, 'product-assets/logo.png'), 'not a PNG')
  expect(() => readProductConfig(f.root)).toThrow('must be a PNG')
})

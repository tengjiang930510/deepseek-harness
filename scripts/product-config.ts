/** Read the branch-owned product configuration and verify generated brand resources. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { z } from 'zod'

/** Checkout used by build entrypoints that run from an application directory. */
export const PRODUCT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const schema = z.strictObject({
  name: z.string().trim().min(1).refine(value =>
    !/[<>:"/\\|?*\x00-\x1f]/u.test(value)
    && !value.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value),
  'name must be a valid macOS and Windows application filename'),
  logo: z.string().min(1),
  appIcon: z.string().min(1).optional(),
})

/**
 * Load one product and its PNG inputs; paths resolve beside product.yml.
 * @param root - Checkout or isolated fixture root.
 * @returns validated input bytes and their content fingerprint.
 */
export function readProductConfig(root = PRODUCT_ROOT): {
  name: string
  logo: Buffer
  appIcon: Buffer | undefined
  fingerprint: string
} {
  const file = resolve(root, 'product-config/product.yml')
  const parsed = schema.safeParse(load(readFileSync(file, 'utf8')))
  if (!parsed.success) throw new Error(`product config: invalid ${file}: ${parsed.error.message}`)
  const image = (path: string): Buffer => {
    const absolute = resolve(dirname(file), path)
    const bytes = readFileSync(absolute)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`product config: ${absolute} must be a PNG image`)
    }
    return bytes
  }
  const logo = image(parsed.data.logo)
  const appIcon = parsed.data.appIcon === undefined ? undefined : image(parsed.data.appIcon)
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed.data)).update(logo).update(appIcon ?? '').digest('hex')
  return { name: parsed.data.name, logo, appIcon, fingerprint }
}

/**
 * Read generated metadata only if it matches the current product inputs.
 * @param root - Checkout root.
 * @param directory - Repository-relative generated or distributed product directory.
 * @returns current generated product metadata.
 */
export function requireProductBuild(root = PRODUCT_ROOT, directory = '.dsh-build/product'): { name: string; fingerprint: string; logo: string } {
  const current = readProductConfig(root)
  const file = resolve(root, directory, 'brand.json')
  let raw: unknown
  try { raw = JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) { throw new Error('product config: missing brand resources; run pnpm run build', { cause: error }) }
  const built = z.object({ name: z.string(), fingerprint: z.string(), logo: z.string() }).parse(raw)
  if (built.fingerprint !== current.fingerprint || built.name !== current.name) {
    throw new Error('product config: brand resources are stale; run pnpm run build')
  }
  for (const name of [built.logo, 'app-icon.png', 'tray.ico']) {
    if (!existsSync(resolve(root, directory, name))) throw new Error(`product config: missing ${name}; run pnpm run build`)
  }
  return built
}

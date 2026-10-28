/** Source-only preload: register custom bundles before the normal dsh Web launcher runs. */
import { requireProductBuild } from './product-config.ts'
import { resolve } from 'node:path'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from '../apps/cli/src/args.ts'
import { registerSourceWebPlugins } from './custom-plugins.ts'

const root = resolve(import.meta.dirname, '..')
const invocation = parseDshArgs(process.argv.slice(2), getDshRuntimeVersion())
if (invocation.mode === 'profile' && invocation.profile === 'web') {
  requireProductBuild(root, 'apps/web/dist/product')
  await registerSourceWebPlugins(root)
}

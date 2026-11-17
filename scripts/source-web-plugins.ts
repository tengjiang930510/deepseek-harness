/** Register checkout bundles before GUI and explicitly declared custom profiles launch. */
import { requireProductBuild } from './product-config.ts'
import { resolve } from 'node:path'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from '../apps/cli/src/args.ts'
import { discoverCustomPlugins, registerSourceProfilePlugins } from './custom-plugins.ts'

const root = resolve(import.meta.dirname, '..')
const invocation = parseDshArgs(process.argv.slice(2), getDshRuntimeVersion())
const selected = invocation.mode === 'profile' ? invocation.profile : undefined
if (selected !== undefined && (selected === 'web'
  || discoverCustomPlugins(root).some(plugin => plugin.profiles?.includes(selected)))) {
  if (selected === 'web') requireProductBuild(root, 'apps/web/dist/product')
  await registerSourceProfilePlugins(root, selected)
}

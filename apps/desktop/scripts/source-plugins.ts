/** Register checkout bundles in the source Desktop home's persistent plugin profile. */
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPlugin } from '../../cli/src/plugin.ts'
import { registerCustomPlugins } from '../../../scripts/custom-plugins.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { createPluginProfile } from '../src/project-manager.ts'

/**
 * Initialize Desktop's external profile and register newly discovered source bundles before Electron starts.
 * User removals and deselections survive restarts; failed registration stops launch and is retried at the next start.
 * @param root - Source checkout whose custom plugins have already been built.
 * @param home - Absolute Harness home selected by the development launcher.
 * @returns After the profile's package operation and registration marker have completed.
 */
export async function registerSourceDesktopPlugins(root: string, home: string): Promise<void> {
  const profileDir = join(home, 'profiles', 'desktop')
  createPluginProfile(profileDir)
  await registerCustomPlugins(root, {
    profileDir,
    async install(specs) {
      console.log('custom plugins: registering source bundles in the Desktop profile')
      // Windows environment names are case-insensitive, including a caller's dsh_home override.
      const inherited = Object.fromEntries(Object.entries(process.env)
        .filter(([name]) => !['DSH_HOME', 'TSX_TSCONFIG_PATH'].includes(name.toUpperCase())))
      await new Promise<void>((complete, reject) => {
        const child = spawn(process.execPath, [
          '--import', import.meta.resolve('tsx/esm'), fileURLToPath(import.meta.url), 'add', ...specs,
        ], {
          cwd: root, env: { ...inherited, DSH_HOME: home,
            TSX_TSCONFIG_PATH: resolve(import.meta.dirname, '../../../tsconfig.json') }, stdio: 'inherit',
        })
        child.once('error', reject)
        child.once('exit', (code, signal) => {
          if (code === 0) complete()
          else reject(new Error(`custom plugins: Desktop registration failed (${String(code ?? signal)}); fix the package-manager error and restart Desktop`))
        })
      })
    },
  })
}

// The source Desktop launcher owns its reserved profile; the public CLI rejects that profile in argv.
if (import.meta.main) {
  const invocation = pnpmInvocation([])
  process.exitCode = await runPlugin('desktop', process.argv.slice(2), { ...invocation, env: {} })
}

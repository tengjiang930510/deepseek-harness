/** Source-or-built public HTTP profile process shared by live and recorded-session tests. */
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { mkdir, symlink } from 'node:fs/promises'
import { initProfile, readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

/**
 * Start the OpenAI profile on an overlay-owned ephemeral port and observe launcher readiness.
 * @param cwd - isolated caller-owned workspace.
 * @param patch - profile overlay path.
 * @param env - explicit test credentials and isolated home locations.
 * @returns the ready address, captured diagnostics, and quiescent process cleanup.
 */
export async function startOpenAiProfile(cwd: string, patch: string, env: NodeJS.ProcessEnv) {
  const repo = resolve(import.meta.dirname, '../../../..')
  if (env.DSH_HOME === undefined) throw new Error('Profile tests require an explicit isolated DSH_HOME')
  const packageDir = resolve(import.meta.dirname, '../..')
  const profile = join(env.DSH_HOME, 'profiles/openai')
  initProfile(profile, ['@deepseek-ai/dsh-base', 't4y-openai-service'])
  const manifest = readProfileManifest('dsh', profile)
  writeProfileManifest(profile, { ...manifest, dependencies: {
    ...manifest.dependencies, 't4y-openai-service': `link:${packageDir}`,
  } })
  const modules = join(profile, 'node_modules')
  await mkdir(modules, { recursive: true })
  await symlink(packageDir, join(modules, 't4y-openai-service'), process.platform === 'win32' ? 'junction' : 'dir')
  const launch = resolveExampleLaunch({
    srcBin: join(repo, 'apps/cli/src/bin.ts'), sourceImport: 'tsx/esm',
    tsconfigPath: join(repo, 'tsconfig.base.json'),
    configArgs: ['--profile', 'openai', '--patch', patch], env,
  })
  const child = spawn(launch.command, launch.args, { cwd, env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let exited = false
  const ready = Promise.withResolvers<string>()
  const closed = new Promise<void>((resolve) => { child.once('close', () => { exited = true; resolve() }) })
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    const address = /dsh openai: (http:\/\/127\.0\.0\.1:\d+)\/v1\/chat\/completions/.exec(output)?.[1]
    if (address !== undefined) ready.resolve(address)
  })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.once('error', ready.reject)
  child.once('exit', () => { ready.reject(new Error(`OpenAI profile exited before ready: ${output}`)) })
  const close = async (): Promise<void> => {
    if (exited) return
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => { child.kill('SIGKILL') }, 10000)
    try { await closed }
    finally { clearTimeout(killTimer) }
  }
  const timeout = setTimeout(() => { ready.reject(new Error(`OpenAI profile startup timed out: ${output}`)) }, 60000)
  try {
    return { base: await ready.promise, output: () => output, close }
  } catch (error) {
    await close()
    throw error
  } finally { clearTimeout(timeout) }
}

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each(['web', 'desktop'])('registers local and npm bundles through the source %s profile operation', (profileName) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-source-plugins-')))
  try {
    const root = join(directory, 'checkout')
    const home = join(directory, 'desktop-home')
    const plugin = join(root, 'tsy-custom-plugins', 'custom-a')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'custom-a', dsh: { bundle: { patch: 'patch.yml' } } }))
    writeFileSync(join(plugin, 'patch.yml'), '- insert: []\n')
    mkdirSync(join(root, 'apps', 'desktop'), { recursive: true })
    writeFileSync(join(root, 'apps', 'desktop', 'packaged-plugins.json'), JSON.stringify({ packages: ['dsh-wechat-plugin'] }))
    const manager = join(directory, 'pnpm.mjs')
    const invocation = join(directory, 'invocation.json')
    writeFileSync(manager, `
      import { writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs'
      import { join } from 'node:path'
      if (process.argv[2] === 'view') {
        process.stdout.write(JSON.stringify({ name: 'dsh-wechat-plugin', version: '1.0.0' }))
        process.exit(0)
      }
      writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({
        args: process.argv.slice(2), cwd: process.cwd(), home: process.env.DSH_HOME,
      }))
      const file = join(process.cwd(), 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      manifest.dependencies['custom-a'] = ${JSON.stringify(`link:${plugin}`)}
      manifest.dependencies['dsh-wechat-plugin'] = '^1.0.0'
      const wechat = join(process.cwd(), 'node_modules', 'dsh-wechat-plugin')
      mkdirSync(wechat, { recursive: true })
      writeFileSync(join(wechat, 'package.json'), JSON.stringify({
        name: 'dsh-wechat-plugin', version: '1.0.0', dsh: { bundle: { patch: 'patch.yml' } },
      }))
      writeFileSync(join(wechat, 'patch.yml'), '- insert: []\\n')
      mkdirSync(join(process.cwd(), 'node_modules'), { recursive: true })
      symlinkSync(${JSON.stringify(plugin)}, join(process.cwd(), 'node_modules', 'custom-a'),
        process.platform === 'win32' ? 'junction' : 'dir')
      writeFileSync(file, JSON.stringify(manifest))
    `)
    const runner = join(directory, 'runner.mjs')
    writeFileSync(runner, profileName === 'desktop' ? `
      import { registerSourceDesktopPlugins } from ${JSON.stringify(new URL('../scripts/source-plugins.ts', import.meta.url).href)}
      await registerSourceDesktopPlugins(${JSON.stringify(root)}, ${JSON.stringify(home)})
    ` : `
      import { registerSourceWebPlugins } from ${JSON.stringify(new URL('../../../scripts/custom-plugins.ts', import.meta.url).href)}
      await registerSourceWebPlugins(${JSON.stringify(root)})
    `)
    const inherited = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !['npm_execpath', 'dsh_home', 'tsx_tsconfig_path'].includes(name.toLowerCase())))
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'), runner], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...inherited, npm_execpath: manager, dsh_home: profileName === 'desktop' ? join(directory, 'wrong-home') : home,
        TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)) },
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(invocation, 'utf8'))).toEqual({
      args: ['add', 'dsh-wechat-plugin@latest', `link:${plugin}`], cwd: join(home, 'profiles', profileName), home,
    })
    expect(JSON.parse(readFileSync(join(home, 'profiles', profileName, 'package.json'), 'utf8')))
      .toMatchObject({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom-a', 'dsh-wechat-plugin'] } } })
    expect(JSON.parse(readFileSync(join(home, 'profiles', profileName, 'source-plugins.json'), 'utf8')))
      .toEqual({ packages: ['custom-a', 'dsh-wechat-plugin'] })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

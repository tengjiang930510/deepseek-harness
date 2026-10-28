import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, type TestContext } from 'vitest'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
const loader = new URL('../src/environment.ts', import.meta.url).href
const driver = `
  import { loadDesktopHostEnvironment } from ${JSON.stringify(loader)}
  const directory = process.argv[1] === 'installed' ? undefined : process.argv[1]
  const environment = loadDesktopHostEnvironment(directory)
  process.stdout.write(JSON.stringify(environment.get('DESKTOP_MODEL_TEST_KEY') ?? null))
`

function fixture(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-project-env-'))
  context.onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const checkout = join(directory, 'repository')
  const home = join(directory, 'home')
  const profile = join(home, 'profiles', 'desktop')
  mkdirSync(checkout, { recursive: true })
  mkdirSync(profile, { recursive: true })
  return {
    checkout, home, profile,
    run(projectDirectory: string | undefined, inherited?: string) {
      const inheritedEnvironment = Object.fromEntries(Object.entries(process.env)
        .filter(([name]) => !['DSH_HOME', 'DESKTOP_MODEL_TEST_KEY', 'TSX_TSCONFIG_PATH'].includes(name.toUpperCase())))
      const result = spawnSync(process.execPath, [
        '--import', import.meta.resolve('tsx/esm'), '--input-type=module', '--eval', driver, projectDirectory ?? 'installed',
      ], {
        cwd: profile,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...inheritedEnvironment, DSH_HOME: home, DESKTOP_MODEL_TEST_KEY: inherited,
          TSX_TSCONFIG_PATH: resolve(repository, 'tsconfig.json'),
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      return result
    },
  }
}

it('reads repository dotenv credentials from a Host running inside its profile', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.checkout, '.env'), 'DESKTOP_MODEL_TEST_KEY=repository-key\n')
  writeFileSync(join(f.profile, '.env'), 'DESKTOP_MODEL_TEST_KEY=profile-key\n')
  writeFileSync(join(f.home, '.env'), 'DESKTOP_MODEL_TEST_KEY=home-key\n')
  const result = f.run(f.checkout)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ value: 'repository-key', source: 'project-env', path: join(f.checkout, '.env') })
})

it('preserves inherited environment values over repository dotenv values', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.checkout, '.env'), 'DESKTOP_MODEL_TEST_KEY=repository-key\n')
  const result = f.run(f.checkout, 'inherited-key')
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ value: 'inherited-key', source: 'process' })
})

it('keeps installed Desktop dotenv loading relative to the Host working directory', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.checkout, '.env'), 'DESKTOP_MODEL_TEST_KEY=repository-key\n')
  writeFileSync(join(f.profile, '.env'), 'DESKTOP_MODEL_TEST_KEY=profile-key\n')
  const result = f.run(undefined)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ value: 'profile-key', source: 'project-env', path: join(f.profile, '.env') })
})

it('retains the Harness-home fallback when the repository has no dotenv file', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.home, '.env'), 'DESKTOP_MODEL_TEST_KEY=home-key\n')
  const result = f.run(f.checkout)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ value: 'home-key', source: 'user-env', path: join(f.home, '.env') })
})

it('allows startup with no dotenv files or model credentials', (context) => {
  const f = fixture(context)
  const result = f.run(f.checkout)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toBeNull()
})

it('rejects repository files that attempt to change the Host bootstrap', (context) => {
  const f = fixture(context)
  writeFileSync(join(f.checkout, '.env'), 'NODE_OPTIONS=--inspect\n')
  const result = f.run(f.checkout)
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('NODE_OPTIONS')
  expect(result.stdout).toBe('')
})

it('rejects a relative source directory before loading dotenv files', (context) => {
  const f = fixture(context)
  const result = f.run('relative-checkout')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('DSH_DESKTOP_PROJECT_ENV_DIR must be an absolute source checkout directory')
})

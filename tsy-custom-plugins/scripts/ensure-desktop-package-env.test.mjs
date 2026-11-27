/**
 * Smoke: ensure-desktop-package-env upserts shared keys and preserves secrets.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const pluginsRoot = path.resolve(scriptsDir, '..')
const repoRoot = path.resolve(pluginsRoot, '..')
const ensureScript = path.join(scriptsDir, 'ensure-desktop-package-env.mjs')
const assertScript = path.join(scriptsDir, 'assert-enterprise-package.mjs')

describe('ensure-desktop-package-env', () => {
  it('writes shared packaging keys and keeps secret lines', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ensure-env-'))
    const desktop = path.join(tmp, 'apps', 'desktop')
    fs.mkdirSync(desktop, { recursive: true })
    const plugins = path.join(tmp, 'tsy-custom-plugins')
    fs.mkdirSync(plugins, { recursive: true })
    fs.copyFileSync(
      path.join(pluginsRoot, 'desktop-enterprise-defaults.json'),
      path.join(plugins, 'desktop-enterprise-defaults.json'),
    )
    fs.mkdirSync(path.join(plugins, 'scripts'), { recursive: true })
    fs.copyFileSync(ensureScript, path.join(plugins, 'scripts', 'ensure-desktop-package-env.mjs'))

    const envWindows = path.join(desktop, '.env.windows')
    fs.writeFileSync(envWindows, [
      'DSH_DESKTOP_APP_ID=wrong.id',
      'DSH_DESKTOP_WINDOWS_TOKEN_PIN=keep-me-secret',
      'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN=',
      '',
    ].join('\n'), 'utf8')

    execFileSync(process.execPath, [path.join(plugins, 'scripts', 'ensure-desktop-package-env.mjs')], {
      cwd: tmp,
      stdio: 'pipe',
    })
    const text = fs.readFileSync(envWindows, 'utf8')
    assert.match(text, /^DSH_DESKTOP_APP_ID=com\.deepseek\.harness$/m)
    assert.match(text, /^DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN=https:\/\/policy\.example\.com$/m)
    assert.match(text, /^DSH_DESKTOP_NPM_REGISTRY=https:\/\/registry\.npmmirror\.com$/m)
    assert.match(text, /^DSH_DESKTOP_WINDOWS_TOKEN_PIN=keep-me-secret$/m)
    assert.match(text, /desktop-enterprise-defaults\.json$/m)
  })
})

describe('assert-enterprise-package', () => {
  it('passes for enterprise resources and fails without gate', async () => {
    const { assertEnterprisePackage } = await import(pathToFileURL(assertScript).href)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-assert-pkg-'))
    const resources = path.join(tmp, 'resources')
    fs.mkdirSync(path.join(resources, 'trial-plugins', 't4y-identity'), { recursive: true })
    fs.writeFileSync(
      path.join(resources, 'trial-plugins', 't4y-identity', 'package.json'),
      '{"name":"t4y-identity"}\n',
    )
    fs.writeFileSync(
      path.join(resources, 'trial-defaults.json'),
      JSON.stringify({
        plugin: 't4y-identity',
        credentialRef: 'T4Y_DESKTOP_ENTERPRISE_GATE',
        credential: 'enabled',
      }),
    )
    assert.equal(assertEnterprisePackage(resources), resources)

    fs.writeFileSync(
      path.join(resources, 'trial-defaults.json'),
      JSON.stringify({ plugin: 't4y-trial-runtime', credentialRef: 'QWEN_TOKEN_PLAN_API_KEY', credential: 'x' }),
    )
    assert.throws(() => assertEnterprisePackage(resources), /T4Y_DESKTOP_ENTERPRISE_GATE/)
  })
})

void repoRoot

/**
 * Fail if a packaged Desktop tree is missing the enterprise gate / trial plugins.
 * Prevents shipping a build that opens the official welcome / API-Key page.
 *
 * Usage:
 *   node tsy-custom-plugins/scripts/assert-enterprise-package.mjs
 *   node tsy-custom-plugins/scripts/assert-enterprise-package.mjs <resourcesDir>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '../..')

/**
 * Resolve resources/ under a packaged app tree.
 * @param {string} [explicit]
 * @returns {string}
 */
function resolveResourcesDir(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const candidate = path.resolve(explicit)
    if (fs.existsSync(path.join(candidate, 'trial-defaults.json'))) return candidate
    if (fs.existsSync(path.join(candidate, 'resources', 'trial-defaults.json'))) {
      return path.join(candidate, 'resources')
    }
    throw new Error(`assert-enterprise-package: no trial-defaults.json under ${candidate}`)
  }
  const bases = [
    path.join(repoRoot, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/resources'),
    path.join(repoRoot, 'apps/desktop/.desktop-build/targets/win-x64/artifacts/win-unpacked/resources'),
    path.join(repoRoot, 'apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts'),
  ]
  for (const base of bases) {
    if (fs.existsSync(path.join(base, 'trial-defaults.json'))) return base
    // mac .app: DeepSeek Harness.app/Contents/Resources
    if (fs.existsSync(base)) {
      const apps = fs.readdirSync(base).filter((name) => name.endsWith('.app'))
      for (const app of apps) {
        const resources = path.join(base, app, 'Contents', 'Resources')
        if (fs.existsSync(path.join(resources, 'trial-defaults.json'))) return resources
      }
    }
  }
  throw new Error('assert-enterprise-package: no packaged resources/ found; pass an explicit path')
}

/**
 * @param {string} [resourcesDir]
 */
export function assertEnterprisePackage(resourcesDir) {
  const resources = resolveResourcesDir(resourcesDir)
  const defaultsPath = path.join(resources, 'trial-defaults.json')
  if (!fs.existsSync(defaultsPath)) {
    throw new Error(`assert-enterprise-package: missing ${defaultsPath}`)
  }
  let defaults
  try {
    defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'))
  } catch (error) {
    throw new Error(`assert-enterprise-package: invalid JSON in ${defaultsPath}: ${error instanceof Error ? error.message : error}`)
  }
  if (defaults?.credentialRef !== 'T4Y_DESKTOP_ENTERPRISE_GATE') {
    throw new Error(
      `assert-enterprise-package: trial-defaults.json credentialRef must be T4Y_DESKTOP_ENTERPRISE_GATE (got ${JSON.stringify(defaults?.credentialRef)}); `
      + 'this build would open the official welcome / API Key page',
    )
  }
  const identityDir = path.join(resources, 'trial-plugins', 't4y-identity')
  if (!fs.existsSync(path.join(identityDir, 'package.json'))) {
    throw new Error(`assert-enterprise-package: missing staged trial-plugins/t4y-identity under ${resources}`)
  }
  console.log(`assert-enterprise-package: ok (${path.relative(repoRoot, resources)})`)
  return resources
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    assertEnterprisePackage(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

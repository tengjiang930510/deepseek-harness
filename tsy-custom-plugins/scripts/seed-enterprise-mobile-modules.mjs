/**
 * Reset / manage mobile client-module exclusions.
 *
 * Aggressive “minimal keep” blanked the phone home (missing cordis runner / related
 * boot graph). Default action is RESET to load all modules.
 *
 * Usage:
 *   node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-modules.mjs
 *   node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-modules.mjs --reset
 */
import fs from 'node:fs'
import path from 'node:path'

const userHome = process.env.USERPROFILE || process.env.HOME
if (!userHome) throw new Error('USERPROFILE/HOME is required')

const dshHome = process.env.DSH_HOME && process.env.DSH_HOME !== ''
  ? process.env.DSH_HOME
  : path.join(userHome, '.dsh')

const prefsFile = path.join(dshHome, 'mobile-access', 'client-modules.json')
const webBase = (process.env.DSH_WEB || 'http://127.0.0.1:3080').replace(/\/$/u, '')

async function resetViaApi() {
  const response = await fetch(`${webBase}/api/mobile-access/client-modules`, {
    method: 'POST',
    headers: {
      'x-dsh-mobile-web-admin': 'same-origin-json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reset: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`reset HTTP ${response.status}: ${JSON.stringify(body)}`)
  return {
    via: 'api',
    excluded: Array.isArray(body.excludedClientModules) ? body.excludedClientModules.length : null,
    reloadRequired: body.reloadRequired === true,
  }
}

function resetViaFile() {
  fs.mkdirSync(path.dirname(prefsFile), { recursive: true })
  fs.writeFileSync(prefsFile, `${JSON.stringify({ version: 1, devices: {} })}\n`, { mode: 0o600 })
  return { via: 'file', excluded: 0, reloadRequired: true }
}

const result = await resetViaApi().catch((error) => {
  console.warn(`API reset failed (${error instanceof Error ? error.message : error}); writing empty prefs…`)
  return resetViaFile()
})

console.log(JSON.stringify(result, null, 2))
console.log(`prefs ${prefsFile}`)
console.log('Phone must fully refresh / re-open. Do not re-apply aggressive exclusions without a boot smoke test.')

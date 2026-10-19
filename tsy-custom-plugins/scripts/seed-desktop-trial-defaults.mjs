/**
 * Seed private Desktop trial defaults from ~/.dsh credentials (gitignored outputs).
 * Never logs secret values.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const userHome = process.env.USERPROFILE ?? process.env.HOME
if (!userHome) throw new Error('USERPROFILE/HOME is required')

const credPath = path.join(userHome, '.dsh', '.credentials.yaml')
const text = fs.readFileSync(credPath, 'utf8')
const match = text.match(/^\s*QWEN_TOKEN_PLAN_API_KEY:\s*(\S+)\s*$/m)
if (!match) throw new Error(`QWEN_TOKEN_PLAN_API_KEY not found in ${credPath}`)
const credential = match[1]
if (!credential.startsWith('sk-')) throw new Error('unexpected credential format')

const patchPath = path.join(userHome, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const patch = fs.readFileSync(patchPath, 'utf8')
if (!patch.trim().startsWith('-')) throw new Error('desktop cordis.patch.yml must start with -')

const buildDir = path.join(repoRoot, 'apps/desktop/.desktop-build')
fs.mkdirSync(buildDir, { recursive: true })
const trialPath = path.join(buildDir, 'trial-defaults.json')
const payload = {
  patch,
  credentialRef: 'QWEN_TOKEN_PLAN_API_KEY',
  credential,
}
fs.writeFileSync(trialPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })

const devHome = path.join(repoRoot, 'apps/desktop/.desktop-build/development/home')
fs.mkdirSync(devHome, { recursive: true })
const devCredPath = path.join(devHome, '.credentials.yaml')
let records = ''
if (fs.existsSync(devCredPath)) {
  const existing = fs.readFileSync(devCredPath, 'utf8')
  const recordsMatch = existing.match(/records:[\s\S]*?(?=\nrefs:|\n*$)/)
  if (recordsMatch) records = `${recordsMatch[0].trimEnd()}\n`
}
fs.writeFileSync(
  devCredPath,
  `version: 1\n${records}refs:\n  QWEN_TOKEN_PLAN_API_KEY: ${credential}\n`,
  { mode: 0o600 },
)

const devProfileDir = path.join(devHome, 'profiles', 'desktop')
fs.mkdirSync(devProfileDir, { recursive: true })
fs.copyFileSync(patchPath, path.join(devProfileDir, 'cordis.patch.yml'))

const envPath = path.join(repoRoot, 'apps/desktop/.env.windows')
const line = 'DSH_DESKTOP_TRIAL_DEFAULTS_FILE=.desktop-build/trial-defaults.json'
let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
if (/^DSH_DESKTOP_TRIAL_DEFAULTS_FILE=/m.test(envText)) {
  envText = envText.replace(/^DSH_DESKTOP_TRIAL_DEFAULTS_FILE=.*$/m, line)
} else {
  const prefix = envText.trimEnd() ? `${envText.trimEnd()}\n\n` : ''
  envText = `${prefix}# Private trial: baked model key for packaged Desktop\n${line}\n`
}
if (!envText.endsWith('\n')) envText += '\n'
fs.writeFileSync(envPath, envText, { mode: 0o600 })

const parsed = JSON.parse(fs.readFileSync(trialPath, 'utf8'))
const keys = Object.keys(parsed).sort().join(',')
if (keys !== 'credential,credentialRef,patch') throw new Error(`bad keys: ${keys}`)
if (!parsed.patch.trim().startsWith('-')) throw new Error('patch format')
if (parsed.credentialRef !== 'QWEN_TOKEN_PLAN_API_KEY') throw new Error('ref')
if (!/^[\x21-\x7e]+$/u.test(parsed.credential)) throw new Error('credential charset')

console.log(`wrote ${path.relative(repoRoot, trialPath)}`)
console.log(`credentialRef ${parsed.credentialRef}`)
console.log(`credentialLength ${parsed.credential.length}`)
console.log(`patchBytes ${Buffer.byteLength(parsed.patch)}`)
console.log(`seeded ${path.relative(repoRoot, devCredPath)}`)
console.log(`env ${path.relative(repoRoot, envPath)}`)

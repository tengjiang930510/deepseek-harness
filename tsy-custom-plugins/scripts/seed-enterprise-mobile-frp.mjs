/**
 * Seed enterprise FRP attach settings under ~/.dsh/mobile-access (shared by Web / Desktop).
 * Idempotent: overwrites provider + frp settings with the Wuhan Metro trial channel.
 *
 * Per-Desktop Origins use `t4y-frp.json` → `publicBaseDomain` (not inside settings.json —
 * dsh-mobile rejects unknown FRP keys). See ops/frp-multi-host-caddy.md.
 *
 * Usage: node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-frp.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const userHome = process.env.USERPROFILE || process.env.HOME
if (!userHome) throw new Error('USERPROFILE/HOME is required')

/** Prefer DSH_HOME when set; otherwise ~/.dsh (same as dsh-mobile state root). */
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME !== ''
  ? process.env.DSH_HOME
  : path.join(userHome, '.dsh')

const mobileRoot = path.join(dshHome, 'mobile-access')
const remote = path.join(mobileRoot, 'remote')
const frpConfig = path.join(remote, 'frp', 'config')

const serverAddress = '47.99.34.208'
/** sslip.io → same IP; replace with corporate `m.example.com` in production. */
const publicBaseDomain = process.env.T4Y_FRP_PUBLIC_BASE_DOMAIN?.trim()
  || `${serverAddress.replaceAll('.', '-')}.sslip.io`

/** Only keys allowed by dsh-mobile `FRP_SETTINGS_KEYS`. */
const settings = {
  version: 1,
  serverAddress,
  serverPort: 7000,
  token: 'nzDQjHNa8JETmK1RXAywq3BglPk5fGd2exhS6I9c',
  // Placeholder until ensurePerHostPublicOrigin rewrites to https://dsh-{id12}.{base}.
  publicOrigin: `https://${serverAddress}`,
  mode: 'attach',
  entryTls: 'public-ip-cert',
  vhostHttpPort: 7080,
}

fs.mkdirSync(frpConfig, { recursive: true })
fs.writeFileSync(path.join(remote, 'provider.json'), `${JSON.stringify({ version: 1, provider: 'frp' })}\n`, { mode: 0o600 })
fs.writeFileSync(path.join(frpConfig, 'settings.json'), `${JSON.stringify(settings)}\n`, { mode: 0o600 })
fs.writeFileSync(
  path.join(mobileRoot, 't4y-frp.json'),
  `${JSON.stringify({ version: 1, publicBaseDomain }, null, 0)}\n`,
  { mode: 0o600 },
)

console.log(`seeded ${path.join(remote, 'provider.json')}`)
console.log(`seeded ${path.join(frpConfig, 'settings.json')}`)
console.log(`seeded ${path.join(mobileRoot, 't4y-frp.json')} base=${publicBaseDomain}`)
console.log(`publicOrigin (placeholder) ${settings.publicOrigin}`)
console.log('Host/Desktop will rewrite publicOrigin per installation-id.')
console.log('VPS wildcard/on-demand TLS: tsy-custom-plugins/ops/frp-multi-host-caddy.md')

/**
 * Seed enterprise FRP attach settings under ~/.dsh/mobile-access (shared by Web / Desktop).
 * Idempotent: overwrites provider + frp settings with the Wuhan Metro trial channel.
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

const root = path.join(dshHome, 'mobile-access')
const remote = path.join(root, 'remote')
const frpConfig = path.join(remote, 'frp', 'config')

const settings = {
  version: 1,
  serverAddress: '47.99.34.208',
  serverPort: 7000,
  token: 'nzDQjHNa8JETmK1RXAywq3BglPk5fGd2exhS6I9c',
  publicOrigin: 'https://47.99.34.208',
  mode: 'attach',
  entryTls: 'public-ip-cert',
  vhostHttpPort: 7080,
}

fs.mkdirSync(frpConfig, { recursive: true })
fs.writeFileSync(path.join(remote, 'provider.json'), `${JSON.stringify({ version: 1, provider: 'frp' })}\n`, { mode: 0o600 })
fs.writeFileSync(path.join(frpConfig, 'settings.json'), `${JSON.stringify(settings)}\n`, { mode: 0o600 })

console.log(`seeded ${path.join(remote, 'provider.json')}`)
console.log(`seeded ${path.join(frpConfig, 'settings.json')}`)
console.log(`publicOrigin ${settings.publicOrigin}`)
console.log('Open Desktop/Web → 设置 → 移动访问 → 开启远程，用「复制远程配对链接」给手机浏览器。')

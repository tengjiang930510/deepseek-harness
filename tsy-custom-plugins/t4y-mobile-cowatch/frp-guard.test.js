import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { localPortFromUpstreamOrigin } from './frp-guard.js'

const root = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(root, name), 'utf8')

describe('frp-guard', () => {
  it('parses upstream origin ports', () => {
    assert.equal(localPortFromUpstreamOrigin('http://127.0.0.1:60489'), 60489)
    assert.equal(localPortFromUpstreamOrigin('https://example.com'), 443)
    assert.equal(localPortFromUpstreamOrigin(''), null)
  })

  it('clears orphans for official reconnect and never spawns frpc', () => {
    const guard = read('frp-guard.js')
    assert.match(guard, /cleared_for_official_reconnect/)
    assert.match(guard, /stopped_orphans_while_soft_off/)
    assert.match(guard, /needReconnect/)
    assert.doesNotMatch(guard, /spawnOwnedFrpc|renderFrpcToml|writeFile/)
    assert.match(guard, /must NEVER point frpc at setup\.json upstream/)
  })
})

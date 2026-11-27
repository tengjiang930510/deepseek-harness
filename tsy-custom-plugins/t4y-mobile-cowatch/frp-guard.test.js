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

  it('enforces a single accepting Host on the shared FRP slot', () => {
    const host = read('index.js')
    assert.match(host, /AcceptingSlotBusyError/)
    assert.match(host, /accepting_slot_busy/)
    assert.match(host, /ACCEPTING_INSTANCE_ID/)
    assert.match(host, /holderId/)
    assert.match(host, /desktopReclaim/)
    assert.match(host, /ACCEPTING_HOLDER_STALE_MS/)
  })

  it('soft-off does not kill frpc while another Host holds accepting', () => {
    const guard = read('frp-guard.js')
    assert.match(guard, /sharedAcceptingAlive/)
    assert.match(guard, /deferred_kill_shared_holder_active/)
    assert.match(guard, /t4y-accepting\.json/)
  })

  it('Host reconnects when guard reports needReconnect while accepting', () => {
    const host = read('index.js')
    assert.match(host, /needReconnect/)
    assert.match(host, /remote\/reconnect/)
    assert.match(host, /hostLoopbackBase/)
  })

  it('QR panel invalidates stale codes when the channel drops', () => {
    const desktop = read('client-src/desktop-access.js')
    assert.match(desktop, /markChannelDown/)
    assert.match(desktop, /pairing\/close/)
    assert.match(desktop, /用手机扫描下方二维码/)
    assert.doesNotMatch(desktop, /本机入口/)
  })
})

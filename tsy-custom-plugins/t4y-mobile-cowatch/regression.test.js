/**
 * Static regression guards for the enterprise mobile hardening pass.
 * These do not boot Cordis; they assert source invariants that previously broke in prod.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(root, name), 'utf8')

describe('mobile-cowatch hardening regressions', () => {
  it('pair script seeds switchAuth via Host seed, not host-session real token', () => {
    const index = read('index.js')
    assert.match(index, /\/api\/t4y-mobile-cowatch\/switch-auth-seed/)
    assert.doesNotMatch(index, /localStorage\.setItem\('t4y\.mobile\.switchAuth\.v1'/)
    assert.match(index, /accountKeyOf\(enterpriseName, userName\)/)
  })

  it('enter page never embeds accessToken in URL hash', () => {
    const enter = read('enter-page.js')
    assert.doesNotMatch(enter, /location\.assign\([^\n]*#resume=/)
    assert.doesNotMatch(enter, /btoa\(unescape\(encodeURIComponent\(JSON\.stringify\(\{\s*accessToken/)
    assert.match(enter, /#handoff=/)
    assert.match(enter, /handoff-mint/)
    assert.match(enter, /handoff-redeem/)
  })

  it('client switcher uses handoff mint and can reseed switchAuth', () => {
    const client = read('client.js')
    assert.doesNotMatch(client, /location\.assign\([^\n]*#resume=/)
    assert.match(client, /handoff-mint/)
    assert.match(client, /ensureSwitchAuth/)
    assert.match(client, /switch-auth-seed/)
    assert.doesNotMatch(client, /localStorage\.setItem\(SWITCH_AUTH_KEY/)
  })

  it('identity never sends placeholder token to Host enterprise APIs', () => {
    const identity = read(join('..', 't4y-identity', 'client.js'))
    assert.match(identity, /Phone placeholder must never hit Host enterprise APIs/)
    assert.match(identity, /if \(session\.accessToken === 'mobile-cowatch'\) return/)
    assert.match(identity, /accessToken === 'mobile-cowatch'/)
  })

  it('Server emit intercept is reversible on plugin unload', () => {
    const index = read('index.js')
    assert.match(index, /function uninstallServerPairIntercept/)
    assert.match(index, /__t4yEnterprisePairOriginalEmit/)
    assert.match(index, /uninstallServerPairIntercept\(\)/)
  })

  it('shared public router handles handoff mint/redeem', () => {
    const index = read('index.js')
    assert.match(index, /handoff-mint/)
    assert.match(index, /respondHandoffMint/)
    assert.match(index, /respondHandoffRedeem/)
  })
})

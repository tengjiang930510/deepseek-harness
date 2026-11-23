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
    const switcher = read(join('client-src', 'phone-switcher.js'))
    assert.match(client, /GENERATED FILE/)
    assert.doesNotMatch(client, /location\.assign\([^\n]*#resume=/)
    assert.match(client, /handoff-mint/)
    assert.match(client, /ensureSwitchAuth/)
    assert.match(client, /switch-auth-seed/)
    assert.doesNotMatch(client, /localStorage\.setItem\(SWITCH_AUTH_KEY/)
    assert.match(switcher, /handoff-mint/)
    assert.match(switcher, /ensureSwitchAuth/)
  })

  it('client.js stays in sync with client-src parts', () => {
    const client = read('client.js')
    for (const part of [
      'shared.js',
      'phone-styles.js',
      'phone-waitgate.js',
      'phone-idle.js',
      'phone-presence.js',
      'desktop-access.js',
      'phone-switcher.js',
      'apply.js',
    ]) {
      assert.match(client, new RegExp(`client-src/${part.replace('.', '\\.')}`))
      assert.ok(read(join('client-src', part)).length > 100, part)
    }
    assert.match(client, /installEnterpriseMobileAccessSimplify/)
    assert.match(read(join('client-src', 'desktop-access.js')), /installEnterpriseMobileAccessSimplify/)
    assert.match(read(join('client-src', 'phone-presence.js')), /sendBeacon/)
    assert.match(read(join('client-src', 'phone-presence.js')), /desiredOnline/)
    assert.match(read('client.js'), /sendBeacon/)
    assert.match(read('client.js'), /desiredOnline/)
    assert.match(read(join('client-src', 'desktop-access.js')), /frp-guard/)
    assert.match(read(join('client-src', 'desktop-access.js')), /clearForReconnect/)
    assert.match(read(join('client-src', 'desktop-access.js')), /gateway_stopped/)
    assert.match(read(join('client-src', 'desktop-access.js')), /Failed to load plugins/)
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
    assert.match(index, /uninstallAllDshMobilePatches/)
    assert.match(index, /restorePatchedPrototype/)
    assert.match(index, /restoreBootBufferFromWrapper/)
  })

  it('serializes mobile-boot upstream reads to avoid ECONNRESET blank boots', () => {
    const index = read('index.js')
    assert.match(index, /t4ySerialAssemble/)
    assert.match(index, /t4yRetryUpstream/)
    assert.match(index, /Failed to load plugins/)
    assert.match(index, /pushBootHtmlInjector/)
    assert.match(index, /injectBootRecoveryHtml/)
    assert.doesNotMatch(index, /Buffer\.from = function t4yBootInjectFrom/)
  })

  it('Host FRP guard honors soft-off grace for offline page', () => {
    const index = read('index.js')
    assert.match(index, /SOFT_OFF_FRP_GRACE_MS = 60_000/)
    assert.match(index, /shouldKeepFrpAlive/)
    assert.match(index, /frpReleaseAt/)
    assert.match(index, /ensureFrpRuntimeGuard\(\{ accepting: shouldKeepFrpAlive\(\) \}\)/)
    assert.match(read(join('client-src', 'desktop-access.js')), /SOFT_OFF_FRP_GRACE_MS = 60_000/)
  })

  it('phone leave beacon and QR expiry auto-refresh are wired', () => {
    const presence = read(join('client-src', 'phone-presence.js'))
    assert.match(presence, /online: online === true/)
    assert.match(presence, /keepalive: keepalive === true/)
    assert.match(presence, /pagehide/)
    assert.match(presence, /visibilitychange/)
    const desktop = read(join('client-src', 'desktop-access.js'))
    assert.match(desktop, /armQrExpireRefresh/)
    assert.match(desktop, /clearQrExpireTimer/)
  })

  it('shared public router handles handoff mint/redeem', () => {
    const index = read('index.js')
    assert.match(index, /handoff-mint/)
    assert.match(index, /respondHandoffMint/)
    assert.match(index, /respondHandoffRedeem/)
  })

  it('connected display uses model + short id, not username-as-label', async () => {
    const index = read('index.js')
    assert.match(index, /formatDeviceDisplay/)
    assert.match(index, /register-device/)
    assert.match(index, /revokeDevicesWithFingerprint/)
    assert.match(index, /crossBrowserDeviceFingerprint/)
    assert.match(index, /xbf2\.model\./)
    assert.match(index, /revokeSiblingPhoneDevices/)
    assert.match(index, /findActivePairedDevice/)
    assert.match(index, /device_revoked/)
    assert.match(index, /换浏览器请先在电脑端点/)
    assert.match(read(join('client-src', 'desktop-access.js')), /每张码只能扫一次/)
    assert.doesNotMatch(
      index,
      /Prefer enterprise displayName whenever Host already has a shared session/,
    )
    const shared = read(join('client-src', 'shared.js'))
    assert.match(shared, /crossBrowserDeviceFingerprint/)
    assert.match(shared, /xbf2\.model\./)
    assert.doesNotMatch(shared, /WEBGL_debug_renderer_info/)
    const desktop = read(join('client-src', 'desktop-access.js'))
    assert.match(desktop, /connectedDeviceLabel/)
    assert.match(desktop, /Account menu: short status/)
    assert.doesNotMatch(desktop, /已连接 · \$\{/)
    assert.match(desktop, /formatConnectedBanner/)
    const {
      formatDeviceDisplay,
      modelFromUserAgent,
      shortDeviceId,
      isConcretePhoneModel,
    } = await import('./index.js')
    assert.equal(isConcretePhoneModel('VER-AN10'), true)
    assert.equal(isConcretePhoneModel('手机'), false)
    assert.equal(modelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iPhone')
    assert.equal(
      modelFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S9180 Build/UP1A) AppleWebKit/537.36'),
      'SM-S9180',
    )
    assert.equal(
      modelFromUserAgent('Mozilla/5.0 (Linux; Android 12; VER-AN10 Build/HONORVER-AN10)'),
      'VER-AN10',
    )
    assert.equal(shortDeviceId('abcdef0123456789abcdef0123456789'), 'abcdef01')
    assert.equal(
      formatDeviceDisplay({ model: 'iPhone', shortId: 'abcdef01', account: '管理员' }),
      'iPhone · abcdef01（管理员）',
    )
    assert.equal(
      formatDeviceDisplay({ model: 'Android', shortId: 'deadbeef' }),
      'Android · deadbeef',
    )
  })
})

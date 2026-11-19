import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  clearHandoffTicketsForTests,
  handoffTicketCountForTests,
  mintHandoffTicket,
  redeemHandoffTicket,
  sanitizeHandoffPayload,
} from './handoff.js'
import { accountKeyOf } from './enter-login.js'

describe('handoff tickets', () => {
  beforeEach(() => {
    clearHandoffTicketsForTests()
  })

  it('rejects placeholder / empty payloads', () => {
    assert.equal(sanitizeHandoffPayload(null), null)
    assert.equal(sanitizeHandoffPayload({ accessToken: 'mobile-cowatch', enterpriseName: 'e', userName: 'u' }), null)
    assert.equal(sanitizeHandoffPayload({ accessToken: 'scan-local', enterpriseName: 'e', userName: 'u' }), null)
    assert.equal(sanitizeHandoffPayload({ accessToken: 'tok', enterpriseName: '', userName: 'u' }), null)
  })

  it('mints a one-time code and redeems once', () => {
    const payload = sanitizeHandoffPayload({
      accessToken: 'enterprise-jwt-example',
      enterpriseName: 'znzs',
      userName: 'admin',
      accountKey: accountKeyOf('znzs', 'admin'),
      expiresAt: Date.now() + 60_000,
      preferSelect: true,
    })
    assert.ok(payload)
    const { code, expiresAt } = mintHandoffTicket(payload)
    assert.equal(typeof code, 'string')
    assert.ok(code.length >= 32)
    assert.ok(expiresAt > Date.now())
    assert.equal(handoffTicketCountForTests(), 1)

    const first = redeemHandoffTicket(code)
    assert.deepEqual(first, payload)
    assert.equal(handoffTicketCountForTests(), 0)

    const second = redeemHandoffTicket(code)
    assert.equal(second, null)
  })

  it('accountKeyOf is stable for the same account', () => {
    assert.equal(accountKeyOf('znzs', 'admin'), accountKeyOf('znzs', 'Admin'))
    assert.notEqual(accountKeyOf('znzs', 'admin'), accountKeyOf('znzs', 'other'))
  })
})

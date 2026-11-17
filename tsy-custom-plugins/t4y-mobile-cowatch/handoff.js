/**
 * One-time cross-origin enter handoff tickets.
 * Phone mints a short-lived code on the target Host (CORS, no cookies), then
 * redeems it on arrival — never put the enterprise accessToken in the URL hash.
 */
import { randomBytes, createHash } from 'node:crypto'

/** @typedef {{
 *   accessToken: string,
 *   enterpriseName: string,
 *   userName: string,
 *   accountKey: string,
 *   expiresAt: number,
 *   preferSelect?: boolean,
 * }} HandoffPayload */

const HANDOFF_TTL_MS = 120_000
const HANDOFF_MAX = 64

/** @type {Map<string, { payload: HandoffPayload, expiresAt: number }>} */
const tickets = new Map()

/**
 * Drop expired tickets; enforce a hard size cap.
 */
function pruneHandoffTickets() {
  const now = Date.now()
  for (const [code, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(code)
  }
  while (tickets.size > HANDOFF_MAX) {
    const oldest = tickets.keys().next().value
    if (oldest === undefined) break
    tickets.delete(oldest)
  }
}

/**
 * @param {unknown} raw
 * @returns {HandoffPayload | null}
 */
export function sanitizeHandoffPayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const body = /** @type {Record<string, unknown>} */ (raw)
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
  if (accessToken === '' || accessToken === 'mobile-cowatch' || accessToken === 'scan-local') return null
  const enterpriseName = typeof body.enterpriseName === 'string' ? body.enterpriseName.trim() : ''
  const userName = typeof body.userName === 'string' ? body.userName.trim() : ''
  if (enterpriseName === '' || userName === '') return null
  const expiresAt = typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
    ? body.expiresAt
    : Date.now() + 8 * 3600_000
  if (expiresAt <= Date.now()) return null
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : ''
  return {
    accessToken,
    enterpriseName,
    userName,
    accountKey,
    expiresAt,
    preferSelect: body.preferSelect === true,
  }
}

/**
 * @param {HandoffPayload} payload
 * @returns {{ code: string, expiresAt: number }}
 */
export function mintHandoffTicket(payload) {
  pruneHandoffTickets()
  const code = createHash('sha256')
    .update(randomBytes(32))
    .digest('base64url')
    .slice(0, 43)
  const expiresAt = Date.now() + HANDOFF_TTL_MS
  tickets.set(code, { payload: { ...payload }, expiresAt })
  return { code, expiresAt }
}

/**
 * One-time redeem. Returns null when missing / expired / already used.
 * @param {string} code
 * @returns {HandoffPayload | null}
 */
export function redeemHandoffTicket(code) {
  if (typeof code !== 'string' || code.trim() === '') return null
  pruneHandoffTickets()
  const key = code.trim()
  const entry = tickets.get(key)
  if (!entry) return null
  tickets.delete(key)
  if (entry.expiresAt <= Date.now()) return null
  if (entry.payload.expiresAt <= Date.now()) return null
  return entry.payload
}

/**
 * Test helper — clear all tickets.
 */
export function clearHandoffTicketsForTests() {
  tickets.clear()
}

/**
 * Test helper — current size after prune.
 * @returns {number}
 */
export function handoffTicketCountForTests() {
  pruneHandoffTickets()
  return tickets.size
}

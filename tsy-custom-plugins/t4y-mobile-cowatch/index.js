/**
 * Host half for mobile co-watch: expose whether the PC already holds the model key.
 * Mobile never talks to Broker / New API; it only checks this Host slot.
 */
export const name = 't4y-mobile-cowatch'
export const inject = {
  connection: true,
  credentials: true,
}

const MODEL_CREDENTIAL_REF = 'T4Y_NEW_API_KEY'

/**
 * @param {number} status
 * @param {unknown} value
 */
function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * @param {import('cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: '/api/t4y-mobile-cowatch/credential-status',
    methods: ['GET'],
    async fetch() {
      try {
        const resolved = await ctx.credentials.resolve(MODEL_CREDENTIAL_REF)
        const present = typeof resolved?.value === 'string' && resolved.value !== ''
        return json(200, { present, ref: MODEL_CREDENTIAL_REF })
      } catch {
        return json(200, { present: false, ref: MODEL_CREDENTIAL_REF })
      }
    },
  })
}

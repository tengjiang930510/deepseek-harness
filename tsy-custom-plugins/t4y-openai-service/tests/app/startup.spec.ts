/** Startup readiness and scoped address publication use the normal command-line and HTTP services. */
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it, vi } from 'vitest'
import * as App from '../../src/app.ts'

it.each([true, false])('publishes startup and prints the address only through launcher readiness: %s', async (withReady) => {
  const ctx = new Context()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  let ready: (() => void) | undefined
  let detached = false
  try {
    provideCmdline(ctx, { args: [], exit() { throw new Error('Unexpected startup exit') },
      ...withReady ? { ready: { onReady(listener: () => void) {
        ready = listener
        return () => { detached = true }
      } } } : {},
    })
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const app = ctx.plugin(App)
    await app.await()
    expect(ctx.get('openaiAppStartup')).toEqual({ accepted: true })
    expect(log).not.toHaveBeenCalled()
    ready?.()
    if (withReady) expect(log).toHaveBeenCalledWith(`dsh openai: ${ctx.webServer.getOrigin()}/v1/chat/completions`)
    await app.dispose()
    expect(ctx.get('openaiAppStartup')).toBeUndefined()
    expect(detached).toBe(withReady)
  } finally {
    await ctx.fiber.dispose()
    log.mockRestore()
  }
})

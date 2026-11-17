/** Command-line startup for the OpenAI-compatible HTTP serving profile. */
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Loader plugin identity. */
export const name = 'openai-app'
/** Launcher arguments are required before the listener can activate. */
export const inject = ['cmdlineArgs']

/**
 * Parse server startup arguments and publish readiness for the HTTP listener.
 * @param ctx - application scope with the dsh launcher.
 */
export function apply(ctx: Context): void {
  const command = new Command().name('dsh --profile openai')
    .description('Serve Harness agents through OpenAI-compatible Chat Completions.')
    .helpOption('-h, --help', 'show this help')
  command.action(() => {
    ctx.provide('openaiAppStartup', { accepted: true })
    ctx.inject(['webServer'], (child) => {
      const ready = child.get('appReady')
      if (ready !== undefined) child.effect(() => ready.onReady(() => {
        console.log(`dsh openai: ${child.webServer.getOrigin()}/v1/chat/completions`)
      }))
    })
  })
  parseCmdline(ctx, command)
}

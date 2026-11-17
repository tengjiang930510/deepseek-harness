/** Caller control selection is resolved and logged separately for each model attempt. */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { expect, it } from 'vitest'
import { MockAdapter, textResponse } from './mock-adapter.ts'

it('applies caller controls to frozen proposals and persists their resolved values on subsequent turns', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    const runtime = await mountAgentLoopTestHarness(ctx)
    const model = new MockAdapter([textResponse('first'), textResponse('second')])
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], model))
    const events: SessionEvent[] = []
    ctx.on('session/event', (_session, event) => { events.push(event) })
    let calls = 0
    const agent = await runtime.create(SessionId('caller-controls'), {
      provider: 'mock', model: 'model', maxTokens: 100,
      configureCall: (controls, metadata) => {
        expect(Object.isFrozen(controls)).toBe(true)
        expect(Object.isFrozen(metadata)).toBe(true)
        expect(metadata.id).toBe('model')
        calls++
        return { ...controls, temperature: calls / 10, stop: ['END'] }
      },
    })
    for (const text of ['one', 'two']) {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    expect(calls).toBe(2)
    expect(model.requests.map(request => request.temperature)).toEqual([0.1, 0.2])
    expect(events.filter(event => event.type === 'request/header').map(event => event.data.header.config)).toEqual([
      { provider: 'mock', model: 'model', maxTokens: 100, temperature: 0.1, stop: ['END'] },
      { provider: 'mock', model: 'model', maxTokens: 100, temperature: 0.2, stop: ['END'] },
    ])
  } finally { await ctx.fiber.dispose() }
})

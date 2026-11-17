/** Stable Session addressing and cancellation-aware ordering with controlled operations. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConversationId } from '../src/request.ts'
import { ConversationQueue, resolveSessionTarget } from '../src/conversation.ts'

it('scopes persistent identities to the route and leaves ordinary requests isolated', () => {
  const conversation = brandString<ConversationId>('chat')
  const first = resolveSessionTarget('one', conversation, 'request-one')
  expect(first).toEqual(resolveSessionTarget('one', conversation, 'request-two'))
  expect(first.persistent).toBe(true)
  expect(first.id).not.toBe(resolveSessionTarget('two', conversation, 'request-one').id)
  expect(first.id).not.toBe(resolveSessionTarget('one', brandString<ConversationId>('other'), 'request-one').id)
  expect(resolveSessionTarget('one', undefined, 'request-one')).toEqual({ id: 'openai-request-one', persistent: false })
})

it('serializes a conversation through operation completion while other conversations run', async () => {
  const queue = new ConversationQueue()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const same = SessionId('same')
  const signal = new AbortController().signal
  const first = queue.run(same, signal, async () => {
    entered.resolve(undefined)
    await release.promise
    return 'first'
  })
  await entered.promise
  const next = vi.fn(async () => 'second')
  const second = queue.run(same, signal, next)
  try {
    expect(await queue.run(SessionId('other'), signal, async () => 'independent')).toBe('independent')
    expect(next).not.toHaveBeenCalled()
  } finally { release.resolve(undefined) }
  expect(await first).toBe('first')
  expect(await second).toBe('second')
  expect(await queue.run(same, signal, async () => 'third')).toBe('third')
})

it('releases failed operations and cancels a waiter without overtaking active work', async () => {
  const queue = new ConversationQueue()
  const same = SessionId('same')
  const signal = new AbortController().signal
  const failure = new Error('operation failed')
  await expect(queue.run(same, signal, () => Promise.reject(failure))).rejects.toBe(failure)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const first = queue.run(same, signal, async () => {
    entered.resolve(undefined)
    await release.promise
  })
  await entered.promise
  const controller = new AbortController()
  const skipped = vi.fn(async () => 'skipped')
  const waiting = queue.run(same, controller.signal, skipped)
  const rejection = expect(waiting).rejects.toBe(failure)
  controller.abort(failure)
  await rejection
  const next = vi.fn(async () => 'next')
  const third = queue.run(same, signal, next)
  try {
    expect(await queue.run(SessionId('other'), signal, async () => 'other')).toBe('other')
    expect(next).not.toHaveBeenCalled()
    expect(skipped).not.toHaveBeenCalled()
  } finally { release.resolve(undefined) }
  await first
  expect(await third).toBe('next')
  await expect(queue.run(same, controller.signal, skipped)).rejects.toBe(failure)
})

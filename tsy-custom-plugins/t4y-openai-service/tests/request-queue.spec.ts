/** Execution-slot ordering and cancellation with explicitly held operations. */
import { expect, it } from 'vitest'
import { RequestQueue } from '../src/request-queue.ts'

it('starts live waiters in order after an active operation fails', async () => {
  const queue = new RequestQueue(1, 10000)
  const first = Promise.withResolvers<void>()
  const seen: string[] = []
  const live = new AbortController()
  const disconnected = new AbortController()
  const running = queue.run(live.signal, () => first.promise)
  const runningFailure = expect(running).rejects.toThrow('execution failed')
  const cancelled = queue.run(disconnected.signal, async () => { seen.push('disconnected') })
  const next = queue.run(live.signal, async () => { seen.push('first waiting') })
  const last = queue.run(live.signal, async () => { seen.push('second waiting') })

  disconnected.abort()
  await expect(cancelled).rejects.toBe(disconnected.signal.reason)
  expect(seen).toEqual([])
  first.reject(new Error('execution failed'))
  await Promise.all([runningFailure, next, last])
  expect(seen).toEqual(['first waiting', 'second waiting'])
})

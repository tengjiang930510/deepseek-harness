/** Only completed or length-limited turns have successful Chat Completions finish reasons. */
import { expect, it } from 'vitest'
import { finishOf } from '../src/run.ts'

it('maps successful terminals and refuses failed, cancelled, and unknown outcomes', () => {
  expect(finishOf({ kind: 'completed' })).toBe('stop')
  expect(finishOf({ kind: 'max-tokens' })).toBe('length')
  expect(() => finishOf({ kind: 'error', error: { code: 'UPSTREAM', message: 'private' } })).toThrow('model execution failed')
  expect(() => finishOf({ kind: 'aborted', reason: { kind: 'user' } })).toThrow('did not complete')
  expect(() => finishOf(undefined)).toThrow('did not complete')
})

/** Deterministic presentation timing, event pairing, and request-owned timer cleanup. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createToolResultMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolProgress } from '../src/progress.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function call(args = '{}', id = 'one', time = 100, name = 'bash'): SessionEvent<'tool/call'> {
  return { type: 'tool/call', seq: SessionSeq(0), time,
    data: { turn: 1, step: 1, callId: brandString<ToolCallId>(id), name, arguments: args } }
}

function result(id = 'one', time = 1300, error?: { name: string; code: string }): SessionEvent<'tool/result'> {
  return { type: 'tool/result', seq: SessionSeq(1), time, surfaceOp: 'append', data: {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId: brandString<ToolCallId>(id),
      content: [{ type: 'text', text: 'private output' }], isError: error !== undefined }),
    ...error === undefined ? {} : { error },
  } }
}

it('uses a public description and emits one compact completion row for a fast call', () => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call('{"description":"检索新闻\\n列表","command":"private command"}'))
  expect(publish).not.toHaveBeenCalled()
  progress.result(result())
  vi.advanceTimersByTime(2000)
  expect(publish.mock.calls).toEqual([['- ✓ 完成：检索新闻 列表 · 1.2 秒']])
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['invalid JSON', '{}', '{"description":" "}', '{"description":42}'])(
  'uses the tool name when arguments lack a usable description: %s', (args) => {
    const publish = vi.fn()
    using progress = new ToolProgress(1500, publish, vi.fn())
    progress.call(call(args))
    progress.result(result())
    expect(publish).toHaveBeenCalledWith('- ✓ 完成：bash · 1.2 秒')
  },
)

it('notifies once for a slow call and retains structured failure status', () => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call('{"description":"访问新闻网站"}'))
  vi.advanceTimersByTime(1499)
  expect(publish).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  vi.advanceTimersByTime(5000)
  progress.result(result('one', 6600, { name: 'ToolError', code: 'TIMEOUT' }))
  expect(publish.mock.calls).toEqual([
    ['- ⏳ 正在执行：访问新闻网站'],
    ['- ✗ 失败：访问新闻网站 · 6.5 秒（TIMEOUT）'],
  ])
})

it('pairs overlapping results by call id and escapes description markdown', () => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call('{"description":"打开 [新闻](url)"}', 'one', 1000))
  progress.call(call('{"description":"提取标题"}', 'two', 2000))
  progress.result(result('two', 2500))
  progress.result(result('one', 900))
  expect(publish.mock.calls).toEqual([
    ['- ✓ 完成：提取标题 · 0.5 秒'],
    ['- ✓ 完成：打开 \\[新闻\\](url) · 0.0 秒'],
  ])
})

it('cancels pending notices on disposal without reporting unfinished calls as complete', () => {
  const publish = vi.fn()
  const progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call())
  progress[Symbol.dispose]()
  progress[Symbol.dispose]()
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(2000)
  expect(publish).not.toHaveBeenCalled()
})

it('hands an asynchronous output failure to the request cancellation owner', () => {
  const error = new Error('output limit')
  const fail = vi.fn()
  using progress = new ToolProgress(1500, () => { throw error }, fail)
  progress.call(call())
  vi.advanceTimersByTime(1500)
  expect(fail).toHaveBeenCalledExactlyOnceWith(error)
})


it('shows actual search terms and the returned source count without exposing result text', () => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call(JSON.stringify({ queries: ['武汉今天的天气', '武汉 气温'] }), 'one', 100, 'web_search'))
  vi.advanceTimersByTime(1500)
  const done = result('one', 1700)
  done.data.meta = { sources: [{ url: 'https://weather.example.test' }], truncated: false, answer: 'private answer' }
  progress.result(done)
  expect(publish.mock.calls).toEqual([
    ['- ⏳ 正在执行：网页搜索「武汉今天的天气、武汉 气温」'],
    ['- ✓ 完成：网页搜索「武汉今天的天气、武汉 气温」 · 1.6 秒 · 1 条来源'],
  ])
})

it('shows the parsed page without URL credentials, query parameters, or fragments', () => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  const args = JSON.stringify({ url: 'https://user:password@weather.example.test/city/wuhan?token=secret#section' })
  progress.call(call(args, 'one', 100, 'web_fetch'))
  const done = result()
  done.data.meta = { url: 'https://weather.example.test/city/wuhan', statusCode: 200, truncated: true }
  progress.result(done)
  expect(publish).toHaveBeenCalledExactlyOnceWith('- ✓ 完成：网页解析「weather.example.test/city/wuhan」 · 1.2 秒 · HTTP 200（内容已截断）')
})

it.each([['web_search', '网页搜索'], ['web_fetch', '网页解析']])('keeps the localized label when %s has invalid arguments', (name, label) => {
  const publish = vi.fn()
  using progress = new ToolProgress(1500, publish, vi.fn())
  progress.call(call('invalid JSON', 'one', 100, name))
  progress.result(result())
  expect(publish).toHaveBeenCalledExactlyOnceWith(`- ✓ 完成：${label} · 1.2 秒`)
})

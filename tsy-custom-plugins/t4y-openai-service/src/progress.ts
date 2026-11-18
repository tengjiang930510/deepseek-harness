/** Compact public tool progress derived from committed Session events. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

const descriptionSchema = z.object({ description: z.string().trim().min(1) })
const searchArgs = z.object({ queries: z.array(z.string()) })
const fetchArgs = z.object({ url: z.string() })
const searchMeta = z.object({ sources: z.array(z.unknown()), truncated: z.boolean().optional() })
const fetchMeta = z.object({ statusCode: z.number().int().min(100).max(599), truncated: z.boolean().optional() })

function formatDetail(text: string): string {
  const characters = Array.from(text.replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  return (characters.length > 120 ? `${characters.slice(0, 119).join('')}…` : characters.join(''))
    .replace(/[\\`*_[\]<>#|~]/gu, '\\$&')
}

function labelOf(name: string, args: string): string {
  let value: unknown
  try { value = JSON.parse(args) }
  catch (_error) { /* Invalid tool JSON is reported by execution; progress uses the tool name. */ }
  if (name === 'web_search') {
    const parsed = searchArgs.safeParse(value)
    const queries = parsed.success ? parsed.data.queries.map(query => query.trim()).filter(Boolean) : []
    const detail = formatDetail(queries.slice(0, 3).join('、'))
    if (detail === '') return '网页搜索'
    const remaining = queries.length > 3 ? `（共 ${queries.length} 个关键词）` : ''
    return `网页搜索「${detail}」${remaining}`
  }
  if (name === 'web_fetch') {
    const parsed = fetchArgs.safeParse(value)
    const url = parsed.success ? URL.parse(parsed.data.url) : null
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) return '网页解析'
    return `网页解析「${formatDetail(`${url.host}${url.pathname}`)}」`
  }
  const parsed = descriptionSchema.safeParse(value)
  return (parsed.success ? parsed.data.description : name)
    .replace(/\s+/g, ' ').replace(/[\\`*_[\]<>#|~]/g, '\\$&')
}

function resultDetail(name: string, meta: unknown): string {
  if (name === 'web_search') {
    const parsed = searchMeta.safeParse(meta)
    if (parsed.success) return ` · ${parsed.data.sources.length} 条来源${parsed.data.truncated ? '（结果已截断）' : ''}`
  }
  if (name === 'web_fetch') {
    const parsed = fetchMeta.safeParse(meta)
    if (parsed.success) return ` · HTTP ${parsed.data.statusCode}${parsed.data.truncated ? '（内容已截断）' : ''}`
  }
  return ''
}

/** Request-owned call tracking and delayed progress notices; disposal clears every timer. */
export class ToolProgress implements Disposable {
  private readonly calls = new Map<ToolCallId, {
    name: string
    label: string
    startedAt: number
    timer: ReturnType<typeof setTimeout>
  }>()

  /**
   * @param delayMs - delay before an unfinished call receives a running notice.
   * @param publish - bounded public progress sink.
   * @param fail - request failure owner for asynchronous sink errors.
   */
  constructor(
    private readonly delayMs: number,
    private readonly publish: (text: string) => void,
    private readonly fail: (error: unknown) => void,
  ) {}

  /**
   * Track a committed call without emitting a separate start row for fast operations.
   * @param event - root Session tool invocation.
   */
  call(event: SessionEvent<'tool/call'>): void {
    const label = labelOf(event.data.name, event.data.arguments)
    const timer = setTimeout(() => {
      try { this.publish(`- ⏳ 正在执行：${label}`) }
      catch (error) { this.fail(error) }
    }, this.delayMs)
    this.calls.set(event.data.callId, { name: event.data.name, label, startedAt: event.time, timer })
  }

  /**
   * Emit one completion row with elapsed time and, for failures, the structured error code.
   * @param event - result paired with an observed root call.
   */
  result(event: SessionEvent<'tool/result'>): void {
    // Every root result follows its call within this request's Session.
    const call = this.calls.get(event.data.message.toolCallId) as NonNullable<ReturnType<typeof this.calls.get>>
    clearTimeout(call.timer)
    this.calls.delete(event.data.message.toolCallId)
    const seconds = (Math.max(0, event.time - call.startedAt) / 1000).toFixed(1)
    const failed = event.data.message.isError === true
    const code = event.data.error === undefined ? '' : `（${event.data.error.code}）`
    const detail = failed ? '' : resultDetail(call.name, event.data.meta)
    this.publish(`- ${failed ? '✗ 失败' : '✓ 完成'}：${call.label} · ${seconds} 秒${detail}${code}`)
  }

  /** Cancel unfinished notices without claiming that their operations completed. */
  [Symbol.dispose](): void {
    for (const call of this.calls.values()) clearTimeout(call.timer)
    this.calls.clear()
  }
}

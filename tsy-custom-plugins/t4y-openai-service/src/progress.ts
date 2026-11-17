/** Compact public tool progress derived from committed Session events. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

const descriptionSchema = z.object({ description: z.string().trim().min(1) })

function labelOf(name: string, args: string): string {
  let value: unknown
  try { value = JSON.parse(args) }
  catch (_error) { /* Invalid tool JSON is reported by execution; progress uses the tool name. */ }
  const parsed = descriptionSchema.safeParse(value)
  return (parsed.success ? parsed.data.description : name)
    .replace(/\s+/g, ' ').replace(/[\\`*_[\]<>#|~]/g, '\\$&')
}

/** Request-owned call tracking and delayed progress notices; disposal clears every timer. */
export class ToolProgress implements Disposable {
  private readonly calls = new Map<ToolCallId, {
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
    this.calls.set(event.data.callId, { label, startedAt: event.time, timer })
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
    this.publish(`- ${failed ? '✗ 失败' : '✓ 完成'}：${call.label} · ${seconds} 秒${code}`)
  }

  /** Cancel unfinished notices without claiming that their operations completed. */
  [Symbol.dispose](): void {
    for (const call of this.calls.values()) clearTimeout(call.timer)
    this.calls.clear()
  }
}

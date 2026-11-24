/** FIFO admission for validated chat requests within one OpenAI service instance. */
import { OpenAiServerError } from './error.ts'

/** Owns execution slots through operation cleanup and discards cancelled waiters. */
export class RequestQueue {
  private readonly waiting = new Set<() => void>()
  private active = 0

  constructor(private readonly maxConcurrent: number, private readonly queueTimeoutMs: number) {}

  /**
   * Run an operation when a slot becomes available.
   * @param signal - client disconnect or service shutdown.
   * @param operation - execution and cleanup that hold a slot.
   * @param onQueued - optional notification emitted when all execution slots are busy.
   * @returns the operation result or a failure from waiting or execution.
   */
  async run<T>(signal: AbortSignal, operation: () => Promise<T>, onQueued?: () => void): Promise<T> {
    signal.throwIfAborted()
    if (this.active < this.maxConcurrent) this.active++
    else {
      onQueued?.()
      signal.throwIfAborted()
      await this.waitForSlot(signal)
    }

    try {
      signal.throwIfAborted()
      return await operation()
    } finally {
      const next = this.waiting.values().next()
      if (next.done) this.active--
      else next.value()
    }
  }

  private waitForSlot(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.waiting.delete(admit)
      }
      const admit = (): void => { cleanup(); resolve() }
      const abort = (): void => {
        cleanup()
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new OpenAiServerError('Harness queue wait expired before execution started. Submit again to try later.', 'QUEUE_TIMEOUT', 504))
      }, this.queueTimeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.add(admit)
    })
  }
}

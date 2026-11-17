/** Stable conversation addressing and request-owned serialization without retaining live Agents. */
import { createHash } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConversationId } from './request.ts'

/** Resolved Session identity and whether later requests may resume its durable log. */
export interface SessionTarget {
  id: SessionId
  persistent: boolean
}

/**
 * Resolve a stable route-scoped Session id, or an isolated request id when no conversation is supplied.
 * @param model - public route id.
 * @param conversation - optional client conversation identity; omission creates an isolated Session.
 * @param requestId - independent HTTP request identity.
 * @returns the Session to create or resume.
 */
export function resolveSessionTarget(model: string, conversation: ConversationId | undefined, requestId: string): SessionTarget {
  return conversation === undefined ? { id: SessionId(`openai-${requestId}`), persistent: false } : {
    id: SessionId(`openai-${createHash('sha256').update(JSON.stringify([model, conversation])).digest('hex')}`),
    persistent: true,
  }
}

function waitFor(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the caller's exact cancellation identity.
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    void previous.then(() => { signal.removeEventListener('abort', abort); resolve() })
  })
}

/** Plugin-owned per-Session queues; active operations own their Agents and durable cleanup. */
export class ConversationQueue {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * Run after this Session's earlier operations settle, including failed or cancelled requests.
   * Waiting cancellation rejects immediately without letting later work overtake its predecessor.
   * @param id - resolved Session identity.
   * @param signal - caller deadline, disconnect, or server shutdown.
   * @param operation - execution and cleanup to serialize.
   * @returns the operation's result, or its unchanged failure.
   */
  async run<T>(id: SessionId, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const release = Promise.withResolvers<void>()
    const tail = previous.then(() => release.promise)
    this.tails.set(id, tail)
    void tail.then(() => { if (this.tails.get(id) === tail) this.tails.delete(id) })
    try {
      await waitFor(previous, signal)
      signal.throwIfAborted()
      return await operation()
    } finally { release.resolve() }
  }
}

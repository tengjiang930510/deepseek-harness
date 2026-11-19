/** Import client-supplied history as a closed Session seed before Agent construction. */
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventInput, SessionId } from '@deepseek-ai/dsh-session'
import type { ChatRequest } from './request.ts'
import type { AdmittedChatInput } from './images.ts'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/**
 * Preserve prior message roles without executing them or importing client commands.
 * Imported assistant records have no provider stream because the client supplied only text.
 * The closed import turn lets the Agent initialize its next turn from the complete seed.
 * @param sessionId - identity of the request Session being constructed.
 * @param request - validated model alias and leading system text.
 * @param history - admitted messages excluding the separately queued current input.
 * @returns validated, contiguous seed events, or undefined when there is no prior conversation.
 */
export function historySeed(
  sessionId: SessionId, request: Pick<ChatRequest, 'model' | 'system'>, history: AdmittedChatInput['history'],
): readonly SessionEvent[] | undefined {
  if (history.length === 0) return undefined
  const session = Session.create(sessionId)
  const events: SessionEvent[] = []
  const append = (input: SessionEventInput): void => { events.push(...session.append([input])) }
  append(['turn/start', { turn: 1 }])
  append(['step/start', { turn: 1, step: 1 }])
  append(['system/message', { turn: 1, step: 1, message: createSystemMessage(request.system) }, { surfaceOp: 'append' }])
  append(['step/end', { turn: 1, step: 1 }])
  let step = 1
  for (const message of history) {
    step++
    append(['step/start', { turn: 1, step }])
    switch (message.role) {
      case 'user':
        append(['user/message', createUserMessage({
          content: message.content, source: { kind: 'user' },
        }), { surfaceOp: 'append' }])
        break
      case 'assistant':
        append(['assistant/message', { turn: 1, step, stream: [], message: createAssistantMessage({
          content: message.content, source: { provider: 'openai-client', model: request.model },
        }) }, { surfaceOp: 'append' }])
        break
      /* v8 ignore next -- Admission leaves only the closed user/assistant union. */
      default: return assertNever(message.role)
    }
    append(['step/end', { turn: 1, step }])
  }
  append(['turn/end', { turn: 1, reason: { kind: 'completed' } }])
  return events
}

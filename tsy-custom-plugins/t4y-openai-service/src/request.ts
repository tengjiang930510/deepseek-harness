/** Strict text-only Chat Completions admission; unsupported semantics never disappear silently. */
import { z } from 'zod'
import { OpenAiServerError } from './error.ts'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Client-owned stable conversation identity, scoped to a public model route. */
export type ConversationId = Branded<'OpenAiConversationId'>

const content = z.union([z.string(), z.array(z.strictObject({ type: z.literal('text'), text: z.string() })).min(1)
  .transform(blocks => blocks.map(block => block.text).join(''))])
const requestSchema = z.strictObject({
  model: z.string().min(1),
  messages: z.array(z.discriminatedUnion('role', [
    z.strictObject({ role: z.literal('system'), content }),
    z.strictObject({ role: z.literal('user'), content }),
    z.strictObject({ role: z.literal('assistant'), content }),
  ])).min(1),
  stream: z.boolean().default(false),
  stream_options: z.strictObject({ include_usage: z.boolean().optional() }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(4)]).optional(),
  n: z.literal(1).optional(),
  tools: z.array(z.never()).optional(),
  tool_choice: z.literal('none').optional(),
  response_format: z.strictObject({ type: z.literal('text') }).optional(),
  top_p: z.literal(1).optional(),
  frequency_penalty: z.literal(0).optional(),
  presence_penalty: z.literal(0).optional(),
  user: z.string().optional(),
  metadata: z.strictObject({ conversation_id: z.string().min(1)
    .refine(value => value.trim() !== '', 'conversation_id must not be blank')
    .transform(value => brandString<ConversationId>(value)) }).optional(),
})

/** Validated text request; the last message is guaranteed to be a non-blank user message. */
export type ChatRequest = z.infer<typeof requestSchema> & {
  /** Current user text admitted by message-order validation. */
  input: string
  /** Leading system contributions joined in client order. */
  system: string
  /** Prior conversation only; system messages and the current input are excluded. */
  history: Extract<z.infer<typeof requestSchema>['messages'][number], { role: 'user' | 'assistant' }>[]
}

/**
 * Parse an untrusted HTTP body and enforce supported message ordering and controls.
 * @param value - decoded JSON body.
 * @returns validated request, with text blocks joined without role conversion.
 */
export function parseRequest(value: unknown): ChatRequest {
  const parsed = requestSchema.safeParse(value)
  if (!parsed.success) throw new OpenAiServerError(`Unsupported or invalid Chat Completions request: ${parsed.error.message}`, 'INVALID_REQUEST', 400)
  const request = parsed.data
  const last = request.messages.at(-1)
  if (last?.role !== 'user' || last.content.trim() === '') {
    throw new OpenAiServerError('messages must end with a non-blank user message.', 'INVALID_REQUEST', 400)
  }
  let conversation = false
  for (const message of request.messages) {
    if (message.role !== 'system') conversation = true
    else if (conversation) throw new OpenAiServerError('system messages must precede conversation messages.', 'INVALID_REQUEST', 400)
  }
  if (request.max_tokens !== undefined && request.max_completion_tokens !== undefined) {
    throw new OpenAiServerError('Specify only one of max_tokens and max_completion_tokens.', 'INVALID_REQUEST', 400)
  }
  if (!request.stream && request.stream_options !== undefined) {
    throw new OpenAiServerError('stream_options requires stream=true.', 'INVALID_REQUEST', 400)
  }
  return { ...request, input: last.content,
    system: request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
    history: request.messages.slice(0, -1).filter(message => message.role !== 'system'),
  }
}

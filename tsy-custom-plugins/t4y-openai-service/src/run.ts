/** One request owns a fresh Agent over a new or restored Session, output observation, and quiescent cleanup. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionTarget } from './conversation.ts'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { assistantStreamChunks, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { Config, ModelRoute } from './config.ts'
import type { ChatRequest } from './request.ts'
import { ToolProgress } from './progress.ts'
import { FileDelivery } from './file-delivery.ts'
import { DELIVER_FILE_TOOL, registerDeliveryTool } from './delivery-tool.ts'
import { publishFiles } from './files.ts'
import { historySeed } from './history.ts'
import { OpenAiServerError, publicError } from './error.ts'

/** Collected root conversation output and complete reported usage, when available. */
export interface RunResult {
  text: string
  /** Public execution progress, excluding model reasoning and raw tool data. */
  progress: string
  finishReason: 'stop' | 'length'
  usage: (TokenUsage & { totalTokens: number }) | undefined
}

/**
 * Translate an observed turn completion without treating cancellation or missing output as success.
 * @param reason - durable terminal, or undefined when the owned activity supplied none.
 * @returns the compatible success finish reason.
 */
export function finishOf(reason: TurnEndReason | undefined): 'stop' | 'length' {
  switch (reason?.kind) {
    case 'completed': return 'stop'
    case 'max-tokens': return 'length'
    case 'error':
      throw new OpenAiServerError('Harness model execution failed; inspect the request log. Effects may have occurred.', 'EXECUTION_FAILED', 502)
    // Other and absent terminals provide no completed response to this client.
    default:
      throw new OpenAiServerError('Harness did not complete this request; inspect the request log before retrying.', 'EXECUTION_FAILED', 502)
  }
}

/**
 * Drive one isolated request through whole-Agent idle, then dispose its owned Agent.
 * Text is emitted only after successful assistant settlement, so retries cannot leak failed prefixes.
 * @param ctx - mounted server plugin scope.
 * @param config - resolved deployment limits.
 * @param route - selected server-owned capability configuration.
 * @param request - validated client messages and generation controls.
 * @param signal - request cancellation, timeout, or plugin teardown.
 * @param emit - synchronous bounded answer or progress sink; a throw cancels the run and becomes its failure.
 * @param target - resolved Session identity and persistence mode.
 * @returns all committed root assistant text; no private tool or reasoning output.
 */
export async function runChat(
  ctx: Context, config: Config, route: ModelRoute, request: ChatRequest,
  signal: AbortSignal, emit: (field: 'content' | 'reasoning_content', text: string) => void, target: SessionTarget,
): Promise<RunResult> {
  const output: string[] = []
  const pendingAnswers: string[] = []
  let bufferedAnswerBytes = 0
  const upload = config.fileUpload?.enabled === true ? config.fileUpload : undefined
  const progress: string[] = []
  let outputBytes = 0
  let steps = 0
  let totalTokens = 0
  const accounting = { complete: true }
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  let terminal: TurnEndReason | undefined
  let failure: unknown
  let currentAgent: Agent | undefined
  const fail = (error: unknown): void => {
    failure ??= error
    try { currentAgent?.cancel({ kind: 'hook', reason: 'OpenAI request failed' }) }
    catch (error) { failure = new AggregateError([failure, error], 'Request cancellation failed') }
  }
  const publish = (field: 'content' | 'reasoning_content', text: string): void => {
    const target = field === 'content' ? output : progress
    const separator = field === 'content' ? '\n\n' : '\n'
    const fragment = `${target.length === 0 ? '' : separator}${text}`
    outputBytes += Buffer.byteLength(fragment)
    if (outputBytes + bufferedAnswerBytes > config.maxOutputBytes) throw new OpenAiServerError('Assistant output exceeds the configured byte limit.', 'OUTPUT_LIMIT', 502)
    emit(field, fragment)
    target.push(fragment)
  }
  await using delivery = upload === undefined ? undefined : new FileDelivery(
    route.cwd, upload, signal, name => publish('reasoning_content', `正在上传文件：${name}`),
  )
  const globalTools = route.tools.filter(name => name !== DELIVER_FILE_TOOL)
  const allowedTools = delivery === undefined ? globalTools : [...globalTools, DELIVER_FILE_TOOL]
  using toolProgress = new ToolProgress(config.progressDelayMs, (text) => { publish('reasoning_content', text) }, fail)
  const abort = (): void => { fail(signal.reason) }
  signal.throwIfAborted()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const maxTokens = request.max_completion_tokens ?? request.max_tokens ?? route.maxTokens
    if (maxTokens > route.maxTokens) throw new OpenAiServerError(`Output limit exceeds this model's ${route.maxTokens}-token per-call ceiling.`, 'INVALID_REQUEST', 400)
    const options: Pick<CreateAgentOptions, 'agentOptions' | 'setup' | 'signal'> = {
      signal,
      agentOptions: {
        provider: route.provider, model: route.model, maxTokens,
        configureCall: controls => ({ ...controls,
          ...request.temperature === undefined ? {} : { temperature: request.temperature },
          ...request.stop === undefined ? {} : { stop: typeof request.stop === 'string' ? [request.stop] : request.stop },
        }),
      },
      setup: (agentCtx) => {
        agentCtx.tools.restrict({ allow: globalTools })
        agentCtx.tools.guard(execution => allowedTools.includes(execution.name) ? undefined : {
          reason: 'This tool is not enabled for this model.', info: { name: 'OpenAiServerError', code: 'TOOL_NOT_ALLOWED' },
        })
        if (delivery !== undefined) registerDeliveryTool(agentCtx, delivery)
        if (delivery !== undefined) agentCtx.systemPrompt.section({
          name: 'openai-file-delivery', order: 101,
          text: 'For downloadable files, call deliver_file after creating each finished file and use its confirmed URL in your final response. '
            + 'Use Markdown image syntax for image previews. Do not invent URLs or start local download servers.',
          interpolate: false,
        })
        const system = request.system
        if (system !== '') agentCtx.systemPrompt.section({ name: 'openai-client', order: 100, text: system, interpolate: false })
        agentCtx.on('agent/pre-step', async (_payload, next) => {
          signal.throwIfAborted()
          if (++steps > config.maxSteps || totalTokens >= config.maxTotalTokens) {
            throw new OpenAiServerError('Harness execution budget exhausted; effects may have occurred.', 'BUDGET', 429)
          }
          return next()
        })
        agentCtx.on('session/event', (_session, event) => {
          try {
            if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
              const reported = event.type === 'assistant/message' ? event.data.usage
                : assistantStreamChunks(event.data.stream, 'usage').at(-1)?.usage
              if (reported === undefined) accounting.complete = false
              else {
                usage.inputTokens += reported.inputTokens + (reported.cacheReadTokens ?? 0) + (reported.cacheWriteTokens ?? 0)
                usage.outputTokens += reported.outputTokens
                totalTokens += reported.totalTokens ?? reported.inputTokens + reported.outputTokens
                  + (reported.cacheReadTokens ?? 0) + (reported.cacheWriteTokens ?? 0)
              }
            }
            if (event.type === 'assistant/message' && event.data.interrupted !== true) {
              const text = event.data.message.content
                .filter(block => block.type === 'text').map(block => block.text).join('')
              if (text === '') return
              const hasToolCalls = event.data.message.content.some(block => block.type === 'tool-call')
              if (!hasToolCalls && upload !== undefined) {
                bufferedAnswerBytes += Buffer.byteLength(text) + (pendingAnswers.length === 0 ? 0 : 2)
                if (bufferedAnswerBytes + outputBytes > config.maxOutputBytes) {
                  throw new OpenAiServerError('Assistant output exceeds the configured byte limit.', 'OUTPUT_LIMIT', 502)
                }
                pendingAnswers.push(text)
              }
              else publish(hasToolCalls ? 'reasoning_content' : 'content', text)
            } else if (event.type === 'tool/call') {
              toolProgress.call(event)
            } else if (event.type === 'tool/result') {
              toolProgress.result(event)
            } else if (event.type === 'turn/end') terminal = event.data.reason
          } catch (error) { fail(error) }
        })
        agentCtx.on('agent/error', ({ error }) => { failure ??= error })
      },
    }
    const stored = target.persistent ? await ctx.sessionPersistence.stat(target.id, { signal }) : undefined
    if (stored !== undefined && stored.header.cwd !== route.cwd) {
      throw new OpenAiServerError('This conversation belongs to a different workspace. Start a new conversation.', 'SESSION_CONFLICT', 409)
    }
    const acquire = async () => {
      if (stored !== undefined) return ctx.agents.resume({ ...options, resumeSessionId: target.id })
      const seed = historySeed(target.id, request)
      return ctx.agents.create({ ...options, sessionId: target.id, meta: { cwd: route.cwd },
        ...seed === undefined ? {} : { seed } })
    }
    const handle = await acquire().catch((error: unknown) => {
      if (error instanceof SessionAlreadyOwnedError) throw new OpenAiServerError('This conversation is active in another owner.', 'SESSION_CONFLICT', 409, { cause: error })
      throw error
    })
    await using _ownedAgent = { [Symbol.asyncDispose]: () => handle.dispose() }
    currentAgent = handle.agent
    signal.throwIfAborted()
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: request.input }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    if (failure !== undefined) throw publicError(failure)
    signal.throwIfAborted()
    const finishReason = finishOf(terminal)
    if (delivery !== undefined && pendingAnswers.length > 0) {
      const answer = await publishFiles(pendingAnswers.join('\n\n'), delivery)
      signal.throwIfAborted()
      bufferedAnswerBytes = 0
      publish('content', answer)
    }
    return { text: output.join(''), progress: progress.join(''), finishReason,
      usage: accounting.complete ? { ...usage, totalTokens } : undefined }
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

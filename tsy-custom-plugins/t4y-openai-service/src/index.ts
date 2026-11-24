/** OpenAI-compatible text Chat Completions over the Harness HTTP and Agent services. */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-shell-env'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Config, defaultOpenAiWorkspace } from './config.ts'
import { OpenAiServerError, errorBody, publicError } from './error.ts'
import { parseRequest } from './request.ts'
import { runChat, type RunResult } from './run.ts'
import { ConversationQueue, resolveSessionTarget } from './conversation.ts'
import { readBody, sendFrame, sendJson, streamAnswer } from './http.ts'
import { PythonMissingReport } from './python-missing.ts'
import { loadPythonGuidance } from './python-guidance.ts'
import { RequestQueue } from './request-queue.ts'

/** Stable Loader plugin identity. */
export const name = 'openai-server'
/** Runtime dependencies needed before serving requests. */
export const inject = ['webServer', 'agents', 'llm', 'systemPrompt', 'tools', 'loader', 'credentials', 'sessionPersistence']
export { Config }

function wireUsage(usage: RunResult['usage']) {
  return usage === undefined ? undefined : { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens }
}

/**
 * Register model discovery and chat routes with optional authentication; unload cancels and drains accepted requests.
 * @param ctx - plugin scope owning routes and request lifetimes.
 * @param config - validated deployment configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const keyRef = config.apiKeyEnv === undefined ? undefined : credentialRef(config.apiKeyEnv)
  if (keyRef !== undefined) {
    const initialCredential = await ctx.credentials.resolve(keyRef)
    if (initialCredential === undefined || initialCredential.value.trim() === '') {
      throw new Error(`openai-server requires a configured credential for ${keyRef}.`)
    }
  }
  if (config.models.length === 0) throw new Error('openai-server requires at least one model.')
  const models = new Map(config.models.map(model => [model.id, model]))
  if (models.size !== config.models.length) throw new Error('openai-server model identifiers must be unique.')
  for (const model of models.values()) {
    if (model.id.trim() === '' || model.provider.trim() === '' || model.model.trim() === '' || !isAbsolute(model.cwd)) {
      throw new Error('openai-server models require non-empty id/provider/model and an absolute cwd.')
    }
  }
  if (config.fileUpload?.enabled === true && !['http:', 'https:'].includes(new URL(config.fileUpload.url).protocol)) {
    throw new Error('fileUpload.url must use HTTP or HTTPS')
  }
  for (const origin of config.fileDownloadOrigins) {
    const url = URL.parse(origin)
    if (url === null || !['http:', 'https:'].includes(url.protocol) || origin !== url.origin) {
      throw new Error('fileDownloadOrigins requires exact HTTP(S) origins without paths or credentials.')
    }
  }
  for (const prefix of config.fileDownloadPathPrefixes) {
    const url = URL.parse(prefix)
    if (url === null || !['http:', 'https:'].includes(url.protocol) ||
        prefix !== url.origin + url.pathname || url.pathname === '/' || !url.pathname.endsWith('/')) {
      throw new Error('fileDownloadPathPrefixes requires absolute HTTP(S) directory URLs without credentials, queries, or fragments.')
    }
  }
  const pythonGuidance = await loadPythonGuidance()
  if ([...models.values()].some(model => resolve(model.cwd) === defaultOpenAiWorkspace)) {
    await mkdir(defaultOpenAiWorkspace, { recursive: true })
  }
  const conversations = new ConversationQueue()
  const missingPython = new PythonMissingReport(defaultOpenAiWorkspace)
  const sessionPython = new WeakMap<Session, string>()
  ctx.inject(['shellEnv'], (child) => {
    child.shellEnv.register({
      name: 'openai-shared-python',
      variables: { DSH_OPENAI_PYTHON: { description: 'Shared Python interpreter for this OpenAI Session.' } },
      resolve: ({ agent }): Record<string, string> => {
        const python = agent === undefined ? undefined : sessionPython.get(agent.session)
        return python === undefined ? {} : { DSH_OPENAI_PYTHON: python }
      },
    })
  })
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  const requests = new RequestQueue(config.maxConcurrent, config.queueTimeoutMs)
  ctx.effect(() => async () => {
    lifetime.abort(new OpenAiServerError('Harness server is shutting down; effects may have occurred.', 'UNAVAILABLE', 503))
    await Promise.all(pending)
  })

  const admit = async (req: IncomingMessage): Promise<void> => {
    if (keyRef === undefined) return
    const resolved = await ctx.credentials.resolve(keyRef)
    const credential = resolved === undefined ? undefined : Buffer.from(`Bearer ${resolved.value}`)
    const supplied = Buffer.from(req.headers.authorization ?? '')
    if (credential === undefined || supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) {
      throw new OpenAiServerError('A valid Bearer API key is required.', 'UNAUTHORIZED', 401)
    }
  }
  const serve = async (req: IncomingMessage, res: ServerResponse, chat: boolean): Promise<void> => {
    const requestId = randomUUID()
    res.setHeader('X-Request-ID', requestId)
    try {
      await admit(req)
      const method = chat ? 'POST' : 'GET'
      if (req.method !== method) {
        res.setHeader('Allow', method)
        sendJson(res, 405, errorBody(new OpenAiServerError(`Use ${method} for this endpoint.`, 'INVALID_REQUEST', 405)), config.maxBufferedBytes)
        return
      }
      if (!chat) {
        sendJson(res, 200, { object: 'list', data: [...models.keys()].map(id => ({ id, object: 'model', created: 0, owned_by: 'deepseek-harness' })) }, config.maxBufferedBytes)
        return
      }
      await complete(req, res, requestId)
    } catch (error) {
      const failure = publicError(error)
      if (failure.status >= 500) ctx.logger.warn(`OpenAI request ${requestId} failed (%s): %O`, failure.code, error)
      if (res.destroyed || res.writableEnded) return
      try {
        if (res.headersSent) { sendFrame(res, errorBody(failure), config.maxBufferedBytes); res.end() }
        else sendJson(res, failure.status, errorBody(failure), config.maxBufferedBytes)
      } catch (writeError) {
        ctx.logger.warn(`OpenAI request ${requestId} response failed: %s`, writeError)
        res.destroy()
      }
    }
  }
  const complete = async (req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> => {
    const cancelled = new AbortController()
    const expire = (): void => {
      cancelled.abort(new OpenAiServerError('Harness request deadline exceeded; effects may have occurred.', 'TIMEOUT', 504))
    }
    const startedAt = performance.now()
    let timer = setTimeout(expire, config.requestTimeoutMs)
    const disconnect = (): void => {
      cancelled.abort(new OpenAiServerError('Client disconnected; effects may have occurred.', 'CANCELLED', 499))
    }
    req.once('aborted', disconnect)
    res.once('close', disconnect)
    const signal = AbortSignal.any([lifetime.signal, cancelled.signal])
    try {
      const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') throw new OpenAiServerError('Content-Type must be application/json.', 'INVALID_REQUEST', 415)
      const request = parseRequest(await readBody(req, config.maxBodyBytes, signal))
      const route = models.get(request.model)
      if (route === undefined) throw new OpenAiServerError('Unknown model; query /v1/models for available identifiers.', 'MODEL_NOT_FOUND', 404)
      const target = resolveSessionTarget(route.id, request.metadata?.conversation_id, requestId)
      res.setHeader('X-DSH-Session-ID', target.id)
      const id = `chatcmpl-${requestId}`
      const created = Math.floor(Date.now() / 1000)
      const chunk = (delta: object, finishReason: string | null = null) => ({ id, object: 'chat.completion.chunk', created, model: route.id,
        choices: [{ index: 0, delta, finish_reason: finishReason }] })
      const startStream = (): void => {
        if (res.headersSent) return
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
        sendFrame(res, chunk({ role: 'assistant' }), config.maxBufferedBytes)
      }
      const reportStatus = (status: 'queued' | 'running'): void => {
        if (!request.stream || req.headers['x-dsh-job-status'] !== '1') return
        startStream()
        sendFrame(res, chunk({ dsh_job_status: status }), config.maxBufferedBytes)
      }
      const execute = async (): Promise<void> => {
        await ctx.loader.await()
        signal.throwIfAborted()
        reportStatus('running')
        const result = await runChat(ctx, config, route, request, signal, (text) => {
          if (!request.stream) return
          startStream()
          sendFrame(res, chunk({ reasoning_content: text }), config.maxBufferedBytes)
        }, target, sessionPython, missingPython, pythonGuidance)
        const usage = wireUsage(result.usage)
        if (request.stream) {
          signal.throwIfAborted()
          startStream()
          await streamAnswer(result.text, config.streamContentDelayMs, signal, content => {
            sendFrame(res, chunk({ content }), config.maxBufferedBytes)
          })
          signal.throwIfAborted()
          sendFrame(res, chunk({}, result.finishReason), config.maxBufferedBytes)
          if (request.stream_options?.include_usage === true) sendFrame(res, { id, object: 'chat.completion.chunk', created, model: route.id, choices: [], usage: usage ?? null }, config.maxBufferedBytes)
          sendFrame(res, '[DONE]', config.maxBufferedBytes)
          res.end()
        } else {
          sendJson(res, 200, { id, object: 'chat.completion', created, model: route.id,
            choices: [{ index: 0, message: { role: 'assistant', content: result.text,
              ...result.progress === '' ? {} : { reasoning_content: result.progress } }, finish_reason: result.finishReason }],
            ...usage === undefined ? {} : { usage } }, config.maxBufferedBytes)
        }
      }
      clearTimeout(timer)
      const remainingMs = config.requestTimeoutMs - (performance.now() - startedAt)
      if (remainingMs <= 0) expire()
      await requests.run(signal, async () => {
        timer = setTimeout(expire, remainingMs)
        if (target.persistent) await conversations.run(target.id, signal, execute)
        else await execute()
      }, () => reportStatus('queued'))
    } finally {
      clearTimeout(timer)
      req.off('aborted', disconnect)
      res.off('close', disconnect)
    }
  }
  for (const [path, chat] of [['/v1/models', false], ['/v1/chat/completions', true]] as const) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, auth: 'anonymous', handler: (req, res) => {
      const task = serve(req, res, chat)
      pending.add(task)
      return task.finally(() => { pending.delete(task) })
    } }))
  }
}

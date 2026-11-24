/** Real Loader/HTTP/Agent composition; only the upstream model is scripted. */
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { startUploadFixture } from './upload-fixture.ts'
import { fixtureFile, fixtureImageDataUrl, startImageFixture } from './image-fixture.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Server from '../src/index.ts'
import { Config } from '../src/config.ts'
import { resolveSessionTarget } from '../src/conversation.ts'
import type { ConversationId } from '../src/request.ts'

function text(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 } }, { type: 'finish', reason: { kind: 'stop' } }]
}

function answerFragments(wire: string): string[] {
  return wire.split('\r\n\r\n').flatMap(frame => {
    if (!frame.startsWith('data: {')) return []
    const event: { choices?: { delta?: { content?: string } }[] } = JSON.parse(frame.slice(6))
    const content = event.choices?.[0]?.delta?.content
    return content === undefined ? [] : [content]
  })
}
function tool(name = 'echo', index = 0, args: Record<string, string> = { value: 'tool output' }): StreamChunk[] {
  const id = brandString<ToolCallId>(`call-${name}`)
  const argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}

class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly entered = Promise.withResolvers<undefined>()
  readonly aborted = Promise.withResolvers<undefined>()
  beforeStream?: () => Promise<void>
  constructor(readonly script: (StreamChunk[] | 'hang')[]) { super() }
  async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    this.entered.resolve(undefined)
    await this.beforeStream?.()
    const entry = this.script.shift()
    if (entry === 'hang') {
      await new Promise<void>((resolve) => {
        const finish = (): void => { this.aborted.resolve(undefined); resolve() }
        if (request.signal?.aborted) finish()
        else request.signal?.addEventListener('abort', finish, { once: true })
      })
      request.signal?.throwIfAborted()
    } else if (entry !== undefined) yield* entry
    else throw new Error('Test model script exhausted')
  }
}

const loaded: { ctx: Context; root: string }[] = []
afterEach(async () => {
  for (const fixture of loaded.splice(0)) {
    await fixture.ctx.fiber.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function fixture(script: (StreamChunk[] | 'hang')[] = [text('answer')], overrides: Partial<Config> = {}, authenticate = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openai-http-'))
  const ctx = new Context()
  loaded.push({ ctx, root })
  const model = new Model(script)
  const events: SessionEvent[] = []
  let executions = 0
  const pythonBindings: (string | undefined)[] = []
  const prerequisites = { name: 'http-test-runtime', async apply(context: Context) {
    await mountAgentLoopTestDependencies(context)
    await context.plugin(ShellEnv, { dshHome: root })
    await context.plugin(LocalAttachmentStore, { dshHome: root })
    await context.plugin(Jsonl, { root: join(root, 'sessions'), compression: 'none' })
    await context.plugin(Credentials, { path: join(root, 'credentials.yml'), dshHome: root, watch: false })
    const credentials = context.get('credentials')
    if (credentials === undefined) throw new Error('Test credentials did not activate')
    await credentials.set(credentialRef('TEST_SERVICE_KEY'), 'test-key')
    const llm = context.get('llm')
    const tools = context.get('tools')
    const shellEnv = context.get('shellEnv')
    if (llm === undefined || tools === undefined || shellEnv === undefined) throw new Error('Test prerequisite services did not activate')
    context.effect(() => llm.registerAdapter(['mock'], model))
    context.effect(() => tools.register(defineTool({
      name: 'echo', description: 'Return the supplied value.', parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, execution) {
        executions++
        pythonBindings.push(shellEnv.collect(execution).DSH_OPENAI_PYTHON)
        return args.value
      },
    })))
    context.on('session/event', (_session, event) => { events.push(event) })
    await mountAgentLoopTestHarness(context)
    context.provide('testRuntimeReady', { ready: true })
  } }
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['test-runtime'] = prerequisites
  ctx.loader.builtins.http = WebServer
  ctx.loader.builtins.openai = Server
  const config: Config = Config({ fileUpload: { enabled: false }, ...authenticate ? { apiKeyEnv: 'TEST_SERVICE_KEY' } : {},
    models: [{ id: 'harness', provider: 'mock', model: 'model', cwd: root, tools: ['echo'], maxTokens: 128 }],
    maxConcurrent: 4, queueTimeoutMs: 10000, maxBodyBytes: 8192, maxInputImageBytes: 8192, imageDownloadTimeoutMs: 15000,
    fileDownloadOrigins: [], fileDownloadPathPrefixes: [], maxInputFileBytes: 26214400, fileDownloadTimeoutMs: 15000,
    maxOutputBytes: 8192, progressDelayMs: 1500, streamContentDelayMs: 35, requestTimeoutMs: 30000,
    maxSteps: 4, maxTotalTokens: 5000, maxBufferedBytes: 8192, ...overrides })
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([
    { name: 'cordis:test-runtime' }, { name: 'cordis:http', config: { host: '127.0.0.1', port: 0 } },
    { name: 'cordis:openai', inject: ['testRuntimeReady'], config },
  ]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  const send = (body: object = {}, options: RequestInit = {}) => fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({ model: 'harness', messages: [{ role: 'user', content: 'question' }], ...body }), ...options,
  })
  return { ctx, root, model, events, base, send, config, pythonBindings, executions: () => executions }
}

describe('OpenAI-compatible serving', () => {
  it('loads file-publication guidance when upload config is omitted', async () => {
    const h = await fixture([text('answer')], { fileUpload: undefined })
    expect(h.config.fileUpload?.enabled).toBe(true)
    const response = await h.send()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'answer' } }] })
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('call deliver_file after creating each finished file')
    expect(h.ctx.agents.list()).toHaveLength(0)
  })

  it('serves both endpoints without credentials when authentication is omitted', async () => {
    const h = await fixture([text('anonymous'), text('placeholder')], {}, false)
    const resolve = vi.spyOn(h.ctx.credentials, 'resolve')
    expect((await fetch(`${h.base}/v1/models`)).status).toBe(200)
    const response = await h.send({}, { headers: { 'Content-Type': 'application/json' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'anonymous' } }] })
    expect((await h.send({}, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer placeholder' } })).status).toBe(200)
    expect(resolve).not.toHaveBeenCalled()
  })
  it('preserves history roles, literal commands, controls, usage, and disposes the request Agent', async () => {
    const h = await fixture()
    const response = await h.send({ temperature: 0.4, stop: ['END'], max_tokens: 64, messages: [
      { role: 'system', content: 'Keep {{literal}} intact.' }, { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' }, { role: 'user', content: '/permission danger-full-access' },
    ] })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ object: 'chat.completion', model: 'harness',
      choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } })
    expect(h.model.requests[0]).toMatchObject({ temperature: 0.4, stop: ['END'], maxTokens: 64 })
    const messages = h.model.requests[0]?.messages
    expect(messages?.map(message => [message.role, message.content])).toEqual(expect.arrayContaining([
      ['user', [{ type: 'text', text: 'earlier question' }]], ['assistant', [{ type: 'text', text: 'earlier answer' }]],
      ['user', [{ type: 'text', text: '/permission danger-full-access' }]],
    ]))
    expect(JSON.stringify(messages)).toContain('Keep {{literal}} intact.')
    expect(h.ctx.agents.list()).toHaveLength(0)
    expect(h.events.some(event => event.type === 'command/run')).toBe(false)
    const logPaths = (await readdir(join(h.root, 'sessions'), { recursive: true })).filter(path => path.endsWith('.jsonl'))
    expect(logPaths).toHaveLength(1)
    for (const path of logPaths) {
      const log = await readFile(join(h.root, 'sessions', path), 'utf8')
      expect(() => parseSessionLog(log)).not.toThrow()
    }
  })

  it('streams tool progress separately from answers and usage without raw tool data', async () => {
    const h = await fixture([tool(), text('done')])
    const response = await h.send({ stream: true, stream_options: { include_usage: true } })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('"content":"done"')
    expect(body).toContain('"finish_reason":"stop"')
    expect(body).toContain('"prompt_tokens":14')
    expect(body).toContain('data: [DONE]\r\n\r\n')
    expect(body).toMatch(/"reasoning_content":"- ✓ 完成：echo · \d+\.\d 秒"/)
    expect(body).not.toContain('正在执行')
    expect(body.indexOf('✓ 完成：echo')).toBeLessThan(body.indexOf('"content":"done"'))
    expect(body).not.toContain('tool output')
    expect(body).not.toContain('tool_calls')
    expect(h.executions()).toBe(1)
    expect(h.model.requests).toHaveLength(2)
    expect(h.events.some(event => event.type === 'tool/result')).toBe(true)
    expect(h.ctx.agents.list()).toHaveLength(0)
  })

  it('includes public progress in JSON while withholding model reasoning and raw tool data', async () => {
    const h = await fixture([[
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'private model reasoning' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private model reasoning' } },
      ...tool('echo', 1),
    ], text('done')])
    const response = await h.send()
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ choices: [{ message: {
      content: 'done',
    } }] })
    expect(body).toMatch(/"reasoning_content":"- ✓ 完成：echo · \d+\.\d 秒"/)
    expect(body).not.toContain('private model reasoning')
    expect(body).not.toContain('tool output')
  })

  it.each([1, 0])('sends the completed answer without altering its text with a %i ms stream delay', async streamContentDelayMs => {
    const answer = '字'.repeat(95) + '🧪\n' + '生成统计图表。'.repeat(40)
    const h = await fixture([text(answer), text(answer)], { streamContentDelayMs })
    const wire = await (await h.send({ stream: true })).text()
    const fragments = answerFragments(wire)
    expect(fragments.join('')).toBe(answer)
    if (streamContentDelayMs > 0) {
      expect(fragments.length).toBeGreaterThan(1)
      expect(fragments[0]).toBe('字'.repeat(95) + '🧪')
    } else expect(fragments).toEqual([answer])
    expect(wire).toMatch(/"finish_reason":"stop"[^\n]+\r\n\r\ndata: \[DONE\]\r\n\r\n$/)
    const response = await h.send()
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: answer } }] })
  })

  it('bounds progress and final answers with one combined output limit', async () => {
    const progress = '- ✓ 完成：echo · 0.0 秒'
    const h = await fixture([tool(), text('done')], { maxOutputBytes: Buffer.byteLength(progress) + 3 })
    const response = await h.send()
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'OUTPUT_LIMIT' } })
    const trace = await fixture([tool(), text('done')], { maxOutputBytes: 1 })
    expect((await trace.send()).status).toBe(502)
  })

  it('preserves streamed progress when a later step fails without claiming completion', async () => {
    const h = await fixture([tool()], { maxSteps: 1 })
    const body = await (await h.send({ stream: true })).text()
    expect(body).toContain('✓ 完成：echo')
    expect(body).toContain('"code":"BUDGET"')
    expect(body).not.toContain('[DONE]')
  })

  it('requires credentials on both endpoints and lists public aliases only', async () => {
    const h = await fixture()
    expect((await fetch(`${h.base}/v1/models`)).status).toBe(401)
    expect((await h.send({}, { headers: { 'Content-Type': 'application/json' } })).status).toBe(401)
    const response = await fetch(`${h.base}/v1/models`, { headers: { Authorization: 'Bearer test-key' } })
    expect(await response.json()).toEqual({ object: 'list', data: [{ id: 'harness', object: 'model', created: 0, owned_by: 'deepseek-harness' }] })
    expect(h.model.requests).toHaveLength(0)
  })

  it('uses a rotated stored credential on the next request', async () => {
    const h = await fixture()
    await h.ctx.credentials.set(credentialRef('TEST_SERVICE_KEY'), 'rotated-key')
    expect((await h.send()).status).toBe(401)
    expect((await h.send({}, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rotated-key' } })).status).toBe(200)
    await h.ctx.credentials.unset(credentialRef('TEST_SERVICE_KEY'))
    expect((await h.send()).status).toBe(401)
  })

  it.each([
    { tools: [{ type: 'function', function: { name: 'external' } }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }] },
    { messages: [{ role: 'user', content: 'x' }, { role: 'system', content: 'late' }, { role: 'user', content: 'y' }] },
    { messages: [{ role: 'assistant', content: 'prefill' }] }, { n: 2 }, { metadata: { conversation_id: ' ' } }, { metadata: { conversation_id: 1 } }, { response_format: { type: 'json_object' } },
    { max_tokens: 129 }, { max_tokens: 10, max_completion_tokens: 10 }, { unexpected: true },
  ])('rejects unsupported requests before running a model: %j', async (body) => {
    const h = await fixture()
    const response = await h.send(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(h.model.requests).toHaveLength(0)
  })

  it('downloads mixed input, stores its ordered attachment and reuses it when the conversation resumes', async () => {
    const source = await startImageFixture()
    try {
      const h = await fixture([text('first'), text('followup')], { maxInputImageBytes: source.bytes })
      const metadata = { conversation_id: 'image-chat' }
      const { url, expired } = source
      const invalid = await h.send({ messages: [{ role: 'user', content: [{ type: 'image_url',
        image_url: { url: 'file:///not-an-input.png' },
      }] }] })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_IMAGE' } })
      const user = { role: 'user', content: [
        { type: 'text', text: '图前' }, { type: 'image_url', image_url: { url } }, { type: 'text', text: '图后' },
      ] }
      const first = await h.send({ metadata, messages: [user] })
      expect(first.status, await first.text()).toBe(200)
      const imageMessage = h.model.requests[0]?.messages.find(message => message.role === 'user' && message.content.some(part => part.type === 'image'))
      expect(imageMessage?.content).toMatchObject([
        { type: 'text', text: '图前' },
        { type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } },
        { type: 'text', text: '图后' },
      ])
      expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('answer directly from the image supplied in the conversation')
      expect(JSON.stringify(h.events)).not.toContain('token=fixture')
      const followup = await h.send({ metadata, messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: expired } }] },
        { role: 'assistant', content: 'first' }, { role: 'user', content: '再看图片' },
      ] })
      expect(followup.status, await followup.text()).toBe(200)
      expect(followup.headers.get('x-dsh-session-id')).toBe(first.headers.get('x-dsh-session-id'))
      expect(h.model.requests[1]?.messages).toContainEqual(imageMessage)
      expect(JSON.stringify(h.model.requests[1]?.messages)).toContain('answer directly from the image supplied in the conversation')
      expect(source.count()).toBe(1)
      const rejected = await h.send({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: expired } }] }] })
      expect(rejected.status).toBe(502)
      expect(await rejected.json()).toMatchObject({ error: { code: 'IMAGE_DOWNLOAD_FAILED' } })
      const image = { type: 'image_url', image_url: { url } }
      const oversized = await h.send({ messages: [{ role: 'user', content: [image, image] }] })
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toMatchObject({ error: { code: 'IMAGE_TOO_LARGE' } })
      expect(h.model.requests).toHaveLength(2)
    } finally {
      await source.close()
    }
  })

  it('rejects disallowed original URLs, redirects, and oversized streamed files before model execution', async () => {
    const source = await startImageFixture()
    try {
      const h = await fixture([], { fileDownloadPathPrefixes: [source.origin + '/files/'], maxInputFileBytes: fixtureFile.length - 1 })
      const send = (url: string) => h.send({ messages: [{ role: 'user', content: [{ type: 'file_url', name: 'original.txt', url }] }] })
      const denied = await send(source.fileUrl.replace('127.0.0.1', 'localhost'))
      expect(denied.status).toBe(400)
      expect(await denied.json()).toMatchObject({ error: { code: 'INVALID_FILE_URL' } })
      const otherPath = await send(source.origin + '/files-private/original')
      expect(otherPath.status).toBe(400)
      expect(await otherPath.json()).toMatchObject({ error: { code: 'INVALID_FILE_URL' } })
      for (const path of ['/api/common/file/reader/file', '/other?next=/api/common/file/read/file']) {
        const response = await send(source.origin + path)
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ error: { code: 'INVALID_FILE_URL' } })
      }
      const redirected = await send(source.redirect)
      expect(redirected.status).toBe(502)
      expect(await redirected.json()).toMatchObject({ error: { code: 'FILE_DOWNLOAD_FAILED' } })
      expect(source.fileCount()).toBe(0)
      const oversized = await send(source.fileUrl)
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } })
      expect(source.fileCount()).toBe(1)
      expect(h.model.requests).toHaveLength(0)
    } finally { await source.close() }
  })

  it('accepts FastGPT Base64 images, validates them, and persists only an attachment reference', async () => {
    const h = await fixture()
    const send = (url: string) => h.send({ messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url } }, { type: 'text', text: '这张图是什么？' },
    ] }] })
    const malformed = await send('data:image/png;base64,%%%')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_IMAGE' } })
    const mismatch = await send(fixtureImageDataUrl.replace('image/png', 'image/jpeg'))
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toMatchObject({ error: { code: 'INVALID_IMAGE' } })
    const valid = await send(fixtureImageDataUrl.replace('image/png', 'application/octet-stream'))
    expect(valid.status, await valid.text()).toBe(200)
    expect(h.model.requests).toHaveLength(1)
    expect(h.model.requests[0]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({
      role: 'user',
      content: [{ type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png' }) }, { type: 'text', text: '这张图是什么？' }],
    })]))
    expect(JSON.stringify(h.events)).not.toContain('base64,')
  })

  it('shares Python across separate Session workspaces when the environment is present', async () => {
    const h = await fixture([tool(), text('first'), tool(), text('second'), tool(), text('third')])
    const pythonDir = join(h.root, '.python-env', process.platform === 'win32' ? 'Scripts' : 'bin')
    const python = join(pythonDir, process.platform === 'win32' ? 'python.exe' : 'python')
    const withoutPython = await h.send()
    expect(withoutPython.status).toBe(200)
    expect(JSON.stringify(h.model.requests[0]?.messages)).not.toContain('DSH_OPENAI_PYTHON')
    await mkdir(pythonDir, { recursive: true })
    await writeFile(python, 'interpreter path fixture', { mode: 0o700 })
    const responses = await Promise.all([h.send(), h.send()])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(new Set(responses.map(response => response.headers.get('x-dsh-session-id'))).size).toBe(2)
    expect(h.pythonBindings).toEqual([undefined, python, python])
    expect(JSON.stringify(h.model.requests[2]?.messages)).toContain('DSH_OPENAI_PYTHON')
  })

  it('resumes one durable conversation with tool history and imports client history only once', async () => {
    const h = await fixture([tool(), text('first answer'), text('second answer')])
    const metadata = { conversation_id: 'same-chat' }
    const first = await h.send({ metadata })
    expect(first.status).toBe(200)
    const second = await h.send({ metadata, messages: [
      { role: 'user', content: 'question' }, { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'followup' },
    ] })
    expect(second.status).toBe(200)
    expect(second.headers.get('x-dsh-session-id')).toBe(first.headers.get('x-dsh-session-id'))
    expect(second.headers.get('x-request-id')).not.toBe(first.headers.get('x-request-id'))
    expect(h.model.requests[2]?.messages.some(message => message.role === 'tool')).toBe(true)
    expect(JSON.stringify(h.model.requests[2]?.messages)).toContain('tool output')
    expect(h.events.filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source?.kind === 'user')
      .map(event => event.data.content)).toEqual([
      [{ type: 'text', text: 'question' }], [{ type: 'text', text: 'followup' }],
    ])
    expect(h.ctx.agents.list()).toHaveLength(0)
    const paths = (await readdir(join(h.root, 'sessions'), { recursive: true })).filter(path => path.endsWith('.jsonl'))
    expect(paths).toHaveLength(1)
    const path = paths[0]
    if (path === undefined) throw new Error('No conversation log')
    const events = parseSessionLog(await readFile(join(h.root, 'sessions', path), 'utf8'))
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
  })

  it('resumes legacy Sessions in their original shared workspace', async () => {
    const h = await fixture([text('original'), text('resumed')])
    const conversationId = brandString<ConversationId>('legacy-chat')
    const { id } = resolveSessionTarget('harness', conversationId, 'unused')
    const agent = await h.ctx.agents.create({
      sessionId: id, meta: { cwd: h.root }, agentOptions: { provider: 'mock', model: 'model' },
    })
    try {
      agent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original question' }], source: { kind: 'user' } }))
      await agent.agent.whenIdle()
    } finally { await agent.dispose() }
    expect((await h.ctx.sessionPersistence.stat(id))?.header.cwd).toBe(h.root)
    const response = await h.send({ metadata: { conversation_id: conversationId } })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('resumed')
    expect((await h.ctx.sessionPersistence.stat(id))?.header.cwd).toBe(h.root)
    expect(await readdir(h.root)).not.toContain(id)
  })

  it('rejects a Session directory symlink before invoking tools or the model', async () => {
    const h = await fixture()
    const conversationId = brandString<ConversationId>('linked-chat')
    const { id } = resolveSessionTarget('harness', conversationId, 'unused')
    await symlink(h.root, join(h.root, id), 'junction')
    const response = await h.send({ metadata: { conversation_id: conversationId } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'SESSION_CONFLICT' } })
    expect(h.model.requests).toHaveLength(0)
  })

  it('recovers the same conversation after server replacement and seeds initial client history', async () => {
    const h = await fixture([text('first'), text('second')])
    const metadata = { conversation_id: 'restart-chat' }
    const first = await h.send({ metadata, messages: [
      { role: 'user', content: 'earlier question' }, { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'current' },
    ] })
    expect(first.status).toBe(200)
    const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:openai')
    await entry?.fiber?.dispose()
    await h.ctx.loader.create({ name: 'cordis:openai', inject: ['testRuntimeReady'], config: h.config })
    await h.ctx.loader.await()
    const second = await h.send({ metadata, messages: [{ role: 'user', content: 'next' }] })
    expect(second.status).toBe(200)
    expect(second.headers.get('x-dsh-session-id')).toBe(first.headers.get('x-dsh-session-id'))
    expect(JSON.stringify(h.model.requests[1]?.messages)).toContain('earlier answer')
    expect(JSON.stringify(h.model.requests[1]?.messages)).toContain('first')
  })

  it('refuses a conversation owned elsewhere or moved to a different route workspace', async () => {
    const h = await fixture()
    const metadata = { conversation_id: 'owned-chat' }
    const first = await h.send({ metadata })
    const rawId = first.headers.get('x-dsh-session-id')
    if (rawId === null) throw new Error('No Session identity')
    const handle = await h.ctx.sessionPersistence.open(SessionId(rawId), 'write')
    try { expect((await h.send({ metadata })).status).toBe(409) }
    finally { await handle.close() }
    const resume = vi.spyOn(h.ctx.agents, 'resume').mockRejectedValueOnce(new Error('Storage unavailable'))
    try { expect((await h.send({ metadata })).status).toBe(500) }
    finally { resume.mockRestore() }
    expect(h.model.requests).toHaveLength(1)
    const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:openai')
    await entry?.fiber?.dispose()
    await h.ctx.loader.create({ name: 'cordis:openai', inject: ['testRuntimeReady'], config: {
      apiKeyEnv: 'TEST_SERVICE_KEY', models: h.config.models.map(route => ({ ...route, cwd: join(h.root, 'other') })),
    } })
    await h.ctx.loader.await()
    const conflict = await h.send({ metadata })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'SESSION_CONFLICT' } })
  })

  it('bounds request bytes and rejects an unknown model', async () => {
    const h = await fixture(undefined, { maxBodyBytes: 256 })
    expect((await h.send({ model: 'missing' })).status).toBe(404)
    expect((await h.send({ user: '你'.repeat(256) })).status).toBe(413)
    expect(h.model.requests).toHaveLength(0)
  })

  it('bounds model steps and assistant output', async () => {
    const limited = await fixture([tool()], { maxSteps: 1 })
    const response = await limited.send()
    expect(response.status).toBe(429)
    expect(limited.model.requests).toHaveLength(1)
    const bytes = await fixture([text('你好')], { maxOutputBytes: 5 })
    expect((await bytes.send()).status).toBe(502)
    expect(bytes.ctx.agents.list()).toHaveLength(0)
  })

  it('cancels and drains a timed-out model', async () => {
    const h = await fixture(['hang'], { requestTimeoutMs: 1000 })
    const response = h.send()
    await h.model.entered.promise
    expect((await response).status).toBe(504)
    await h.model.aborted.promise
    expect(h.ctx.agents.list()).toHaveLength(0)
  })

  it('serves all 20 requests with at most eight simultaneous model executions', async () => {
    const replies = Array.from({ length: 20 }, () => text('answer'))
    const h = await fixture(replies, { maxConcurrent: 8 })
    const release = Promise.withResolvers<void>()
    let active = 0
    let peak = 0
    h.model.beforeStream = async () => {
      active++
      peak = Math.max(peak, active)
      try { await release.promise }
      finally { active-- }
    }
    const responses = Promise.all(Array.from({ length: 20 }, () => h.send()))
    try {
      await vi.waitFor(() => expect(h.model.requests).toHaveLength(8), { timeout: 10000 })
    } finally { release.resolve() }
    expect((await responses).map(response => response.status)).toEqual(Array(20).fill(200))
    expect(h.model.requests).toHaveLength(20)
    expect(peak).toBe(8)
  })

  it('expires a queued request without opening a Session or invoking its model', async () => {
    const h = await fixture(['hang'], { maxConcurrent: 1, queueTimeoutMs: 50 })
    const abort = new AbortController()
    const first = h.send({}, { signal: abort.signal }).catch(error => error)
    try {
      await h.model.entered.promise
      const second = await h.send({ stream: true })
      expect(second.status).toBe(504)
      expect(await second.json()).toMatchObject({ error: { code: 'QUEUE_TIMEOUT' } })
      expect(h.ctx.agents.list()).toHaveLength(1)
      expect(h.model.requests).toHaveLength(1)
      expect((await h.send({ model: 'missing' })).status).toBe(404)
    } finally {
      abort.abort()
      await first
    }
  })

  it('reports scheduler state and preserves the timeout error for opted-in streams', async () => {
    const h = await fixture(['hang'], { maxConcurrent: 1, queueTimeoutMs: 50 })
    const abort = new AbortController()
    const first = h.send({}, { signal: abort.signal }).catch(error => error)
    try {
      await h.model.entered.promise
      const response = await h.send({ stream: true }, {
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key', 'X-DSH-Job-Status': '1' },
      })
      expect(response.status).toBe(200)
      const wire = await response.text()
      expect(wire).toContain('"dsh_job_status":"queued"')
      expect(wire).toContain('"code":"QUEUE_TIMEOUT"')
      expect(wire).not.toContain('"dsh_job_status":"running"')
      expect(wire).not.toContain('[DONE]')
      expect(h.model.requests).toHaveLength(1)
    } finally {
      abort.abort()
      await first
    }
  })

  it('reports a queued request starting on the same stream and leaves the default stream unchanged', async () => {
    const h = await fixture([text('plain'), text('opted in')], { maxConcurrent: 1 })
    const release = Promise.withResolvers<void>()
    h.model.beforeStream = () => release.promise
    const first = h.send({ stream: true })
    let second: Response
    try {
      await h.model.entered.promise
      second = await h.send({ stream: true }, {
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key', 'X-DSH-Job-Status': '1' },
      })
      expect(h.model.requests).toHaveLength(1)
    } finally { release.resolve() }

    const wire = await second.text()
    expect(wire).toMatch(/"dsh_job_status":"queued"[\s\S]*"dsh_job_status":"running"/)
    expect(answerFragments(wire).join('')).toBe('opted in')
    expect(await (await first).text()).not.toContain('dsh_job_status')
  })

  it('cancels work on unload', async () => {
    const h = await fixture(['hang'], { maxConcurrent: 1 })
    const first = h.send()
    await h.model.entered.promise
    const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:openai')
    await entry?.fiber?.dispose()
    expect((await first).status).toBe(503)
    await h.model.aborted.promise
    expect(h.ctx.agents.list()).toHaveLength(0)
    expect((await fetch(`${h.base}/v1/models`)).status).toBe(404)
  })

  it.each([true, false])('separates simultaneous request workspaces and histories (persistent=%s)', async persistent => {
    const h = await fixture([text('first answer'), text('second answer')])
    const both = Promise.withResolvers<undefined>()
    let started = 0
    h.model.beforeStream = async () => {
      if (++started === 2) both.resolve(undefined)
      await both.promise
    }
    const responses = await Promise.all(['first', 'second'].map(question => h.send({ ...(persistent ? { metadata: { conversation_id: question } } : {}), messages: [{ role: 'user', content: question }] })))
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const bodies: unknown[] = []
    for (const response of responses) bodies.push(await response.json())
    expect(bodies).toEqual(expect.arrayContaining(['first answer', 'second answer'].map((content): unknown => expect.objectContaining({
      choices: [expect.objectContaining({ message: { role: 'assistant', content } })],
    }))))
    expect(new Set(responses.map(response => response.headers.get('x-request-id'))).size).toBe(2)
    const ids = responses.map(response => response.headers.get('x-dsh-session-id'))
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      if (id === null) throw new Error('Missing Session identifier')
      const stored = await h.ctx.sessionPersistence.stat(SessionId(id))
      expect(stored?.header.cwd).toBe(join(h.root, id))
      expect(await readdir(join(h.root, id))).toEqual([])
    }
    expect(h.model.requests).toHaveLength(2)
    expect(started).toBe(2)
    expect(h.model.requests.map(request => request.messages.filter(message => message.role === 'user'
      && message.source?.kind === 'user').map(message => message.content))).toEqual(expect.arrayContaining([
      [[{ type: 'text', text: 'first' }]], [[{ type: 'text', text: 'second' }]],
    ]))
    expect(h.ctx.agents.list()).toHaveLength(0)
  })

  it('cancels a disconnected client and drains its Agent', async () => {
    const h = await fixture(['hang'])
    const controller = new AbortController()
    const disposed = Promise.withResolvers<undefined>()
    h.ctx.on('agent/disposed', () => { disposed.resolve(undefined) })
    const response = h.send({}, { signal: controller.signal }).catch((error: unknown) => error)
    await h.model.entered.promise
    controller.abort()
    await response
    await h.model.aborted.promise
    await disposed.promise
    expect(h.ctx.agents.list()).toHaveLength(0)
  })

  it('rejects unlisted tool execution and counts the reported token budget between calls', async () => {
    const h = await fixture([tool('disabled'), text('denied')])
    const denied = await h.send()
    expect(denied.status).toBe(200)
    const deniedBody = await denied.text()
    expect(JSON.parse(deniedBody)).toMatchObject({ choices: [{ message: {
      content: 'denied',
    } }] })
    expect(deniedBody).toMatch(/"reasoning_content":"- ✗ 失败：disabled · \d+\.\d 秒（TOOL_NOT_ALLOWED）"/)
    expect(h.executions()).toBe(0)
    const budget = await fixture([tool()], { maxTotalTokens: 7 })
    const response = await budget.send()
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: { code: 'BUDGET' } })
    expect(budget.model.requests).toHaveLength(1)
  })

  it('omits incomplete usage and preserves a length finish', async () => {
    const h = await fixture([[...text('partial').filter(chunk => chunk.type !== 'usage' && chunk.type !== 'finish'),
      { type: 'finish', reason: { kind: 'max-tokens' } }]])
    const response = await h.send()
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })
    const streaming = await fixture([text('answer').filter(chunk => chunk.type !== 'usage')])
    expect(await (await streaming.send({ stream: true, stream_options: { include_usage: true } })).text()).toContain('"usage":null')
  })

  it('withholds failed model prefixes and bounds the complete SSE frame', async () => {
    const failed = await fixture([[{ type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'secret failed prefix' },
      { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: 'private provider diagnostic' } } }]])
    const response = await failed.send({ stream: true })
    const body = await response.text()
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(body).not.toContain('secret failed prefix')
    expect(body).not.toContain('private provider diagnostic')
    const overflow = await fixture([text('x'.repeat(24000))], { maxOutputBytes: 32000, maxBufferedBytes: 1024 })
    const wire = await (await overflow.send({ stream: true })).text()
    expect(wire).toContain('"code":"OUTPUT_LIMIT"')
    expect(wire).not.toContain('[DONE]')
    expect(overflow.ctx.agents.list()).toHaveLength(0)
  })

  it.each([
    { apiKeyEnv: 'UNCONFIGURED_TEST_KEY' }, { models: [] },
    { models: [{ id: 'duplicate', provider: 'mock', model: 'model', cwd: '/', tools: [], maxTokens: 10 },
      { id: 'duplicate', provider: 'mock', model: 'model', cwd: '/', tools: [], maxTokens: 10 }] },
    { models: [{ id: ' ', provider: 'mock', model: 'model', cwd: '/', tools: [], maxTokens: 10 }] },
    { models: [{ id: 'x', provider: ' ', model: 'model', cwd: '/', tools: [], maxTokens: 10 }] },
    { models: [{ id: 'x', provider: 'mock', model: ' ', cwd: '/', tools: [], maxTokens: 10 }] },
    { models: [{ id: 'x', provider: 'mock', model: 'model', cwd: 'relative', tools: [], maxTokens: 10 }] },
  ])('refuses an unusable deployment configuration: %j', async (overrides) => {
    await expect(fixture(undefined, overrides)).rejects.toThrow()
  })

  it('requires the endpoint method and JSON media type before execution', async () => {
    const h = await fixture()
    const headers = { Authorization: 'Bearer test-key' }
    const wrongChat = await fetch(`${h.base}/v1/chat/completions`, { headers })
    expect(wrongChat.status).toBe(405)
    expect(wrongChat.headers.get('allow')).toBe('POST')
    const wrongModels = await fetch(`${h.base}/v1/models`, { method: 'POST', headers })
    expect(wrongModels.status).toBe(405)
    expect(wrongModels.headers.get('allow')).toBe('GET')
    expect((await h.send({}, { headers })).status).toBe(415)
    expect((await h.send({ stream_options: { include_usage: true } })).status).toBe(400)
    expect((await h.send({}, { body: '{' })).status).toBe(400)
    expect(h.model.requests).toHaveLength(0)
  })

  it('joins ordered text blocks, accepts a string stop and completion cap, and separates tool commentary from the final answer', async () => {
    const h = await fixture([[...text('working').filter(chunk => chunk.type !== 'finish'), ...tool('echo', 1)], text('done')])
    const response = await h.send({ messages: [{ role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }],
      max_completion_tokens: 64, stop: 'END', stream: true })
    const wire = await response.text()
    expect(wire).toContain('"reasoning_content":"working"')
    expect(wire).toContain('"content":"done"')
    expect(wire).not.toContain('"choices":[]')
    expect(h.model.requests[0]).toMatchObject({ stop: ['END'], maxTokens: 64 })
  })

  it('fails closed when a slow client cannot receive even an error frame', async () => {
    const h = await fixture(undefined, { maxBufferedBytes: 1 })
    const exchange = async () => (await h.send({ stream: true })).text()
    await expect(exchange()).rejects.toThrow()
    expect(h.ctx.agents.list()).toHaveLength(0)
    await expect(h.send()).rejects.toThrow()
  })

  it('denies a scope-local tool even when another plugin registers it after creation', async () => {
    const h = await fixture([tool('injected'), text('done')])
    let called = false
    h.ctx.on('agent/created', ({ agent }) => {
      agent.ctx.tools.register(defineTool({ name: 'injected', description: 'Test a scoped contribution.',
        parameters: { value: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { called = true; return '' },
      }))
    })
    expect((await h.send()).status).toBe(200)
    expect(called).toBe(false)
    expect(h.events.filter(event => event.type === 'tool/result').map(event => event.data.error?.code)).toContain('TOOL_NOT_ALLOWED')
  })

  it('contains a cancellation failure and still waits for the Agent to stop', async () => {
    const h = await fixture(undefined, { maxOutputBytes: 1 })
    h.ctx.on('agent/created', ({ agent }) => {
      const cancel = agent.cancel.bind(agent)
      vi.spyOn(agent, 'cancel').mockImplementation((cause, options) => {
        cancel(cause, options)
        throw new Error('cancellation journal failed after abort')
      })
    })
    const response = await h.send()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'EXECUTION_FAILED' } })
    expect(h.ctx.agents.list()).toHaveLength(0)
  })
})


async function seedDeliveryFile(root: string) {
  const conversationId = brandString<ConversationId>('file-delivery')
  const workspace = join(root, resolveSessionTarget('harness', conversationId, 'unused').id)
  await mkdir(workspace)
  const file = join(workspace, 'report.pdf')
  await writeFile(file, 'example')
  return { file, metadata: { conversation_id: conversationId } }
}

describe('file delivery over OpenAI HTTP', () => {
  it.each([false, true])('uploads a document and returns only its public URL: stream=%s', async stream => {
    const upload = await startUploadFixture()
    try {
      const h = await fixture([text('[下载报告](report.pdf)')], { fileUpload: {
        enabled: true, url: upload.url, businessKey: 'zhjl',
        maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
      } })
      const { file, metadata } = await seedDeliveryFile(h.root)
      const response = await h.send({ stream, metadata })
      const body = await response.text()
      expect(response.status, body).toBe(200)
      expect(body).toContain('[下载报告](<https://files.example.test/delivery>)')
      expect(body).not.toContain('[下载报告](report.pdf)')
      expect(body).toContain('正在上传文件：report.pdf')
      expect(upload.count()).toBe(1)
      expect(await readFile(file, 'utf8')).toBe('example')
      if (stream) expect(body).toContain('data: [DONE]')
    } finally {
      await upload.close()
    }
  })

  it('reports an upload failure before sending any answer fragments', async () => {
    const upload = await startUploadFixture(500)
    try {
      const answer = '统计结果。'.repeat(50) + '[下载报告](report.pdf)'
      const h = await fixture([text(answer)], { fileUpload: {
        enabled: true, url: upload.url, businessKey: 'zhjl',
        maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
      } })
      const { metadata } = await seedDeliveryFile(h.root)
      const wire = await (await h.send({ stream: true, metadata })).text()
      expect(upload.count()).toBe(1)
      expect(answerFragments(wire)).toEqual([])
      expect(wire).toContain('"code":"FILE_UPLOAD_FAILED"')
      expect(wire).not.toContain('[DONE]')
    } finally {
      await upload.close()
    }
  })
})

describe('explicit deliver_file tool', () => {
  it.each([false, true])('returns a confirmed tool URL and persists it without uploading again: stream=%s', async stream => {
    const upload = await startUploadFixture()
    try {
      const h = await fixture([tool('deliver_file', 0, { path: 'report.pdf' }), text('[下载报告](report.pdf)\n\n[预览报告](/files/report.pdf)')], { fileUpload: {
        enabled: true, url: upload.url, businessKey: 'zhjl', maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
      } })
      const { metadata } = await seedDeliveryFile(h.root)
      const response = await h.send({ stream, metadata })
      const body = await response.text()
      expect(response.status, body).toBe(200)
      expect(body).toContain('[下载报告](<https://files.example.test/delivery>)')
      expect(body).toContain('[预览报告](<https://files.example.test/delivery>)')
      expect(upload.count()).toBe(1)
      expect(JSON.stringify(h.model.requests[1]?.messages)).toContain('https://files.example.test/delivery')
      const event = h.events.find(event => event.type === 'tool/result')
      if (event?.type !== 'tool/result') throw new Error('Missing delivery result')
      expect(event.data.message.isError).not.toBe(true)
      expect(JSON.stringify(event.data.message)).toContain('https://files.example.test/delivery')
      const paths = (await readdir(join(h.root, 'sessions'), { recursive: true })).filter(path => path.endsWith('.jsonl'))
      const persisted = await readFile(join(h.root, 'sessions', paths[0]!), 'utf8')
      const recorded = parseSessionLog(persisted).find(event => event.type === 'tool/result')
      expect(JSON.stringify(recorded)).toContain('https://files.example.test/delivery')
      expect(h.ctx.agents.list()).toHaveLength(0)
    } finally { await upload.close() }
  })

  it.each([false, true])('keeps confirmed downloads when an extra reference exceeds the count: stream=%s', async stream => {
    const upload = await startUploadFixture()
    try {
      const h = await fixture([tool('deliver_file', 0, { path: 'report.pdf' }), text('[已交付](report.pdf) 额外文件：`extra.txt`')], { fileUpload: {
        enabled: true, url: upload.url, businessKey: 'zhjl', maxFileBytes: 1024, maxFiles: 1, timeoutMs: 30000, maxResponseBytes: 1024,
      } })
      const { file, metadata } = await seedDeliveryFile(h.root)
      await writeFile(join(file, '..', 'extra.txt'), 'extra')
      const response = await h.send({ stream, metadata })
      const body = await response.text()
      expect(response.status, body).toBe(200)
      expect(body).toContain('https://files.example.test/delivery')
      expect(body).toContain('文件未交付：本轮文件数量已达上限')
      expect(upload.count()).toBe(1)
    } finally { await upload.close() }
  })

  it('does not register or execute delivery when uploads are disabled', async () => {
    const h = await fixture([tool('deliver_file', 0, { path: 'report.pdf' }), text('Delivery unavailable')])
    const response = await h.send()
    expect(response.status).toBe(200)
    const error = h.events.find(event => event.type === 'tool/result')
    if (error?.type !== 'tool/result') throw new Error('Missing denied delivery result')
    expect(error.data.message.isError).toBe(true)
    expect(JSON.stringify(h.model.requests[0]?.tools)).not.toContain('deliver_file')
  })
})

it('records a failed deliver_file as a structured tool failure without publishing a URL', async () => {
  const upload = await startUploadFixture()
  try {
    const h = await fixture([tool('deliver_file', 0, { path: 'missing.pdf' }), text('File delivery failed')], { fileUpload: {
      enabled: true, url: upload.url, businessKey: 'zhjl', maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
    } })
    const response = await h.send()
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('File delivery failed')
    const result = h.events.find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('Missing failed delivery result')
    expect(result.data.message.isError).toBe(true)
    expect(result.data.error).toMatchObject({ name: 'FileDeliveryError', code: 'FILE_UPLOAD_FAILED' })
    expect(upload.count()).toBe(0)
  } finally { await upload.close() }
})

it.each([false, true])('preserves a successful delivery when the answer mentions an outside original: stream=%s', async stream => {
  const originals = await mkdtemp(join(tmpdir(), 'dsh-http-original-'))
  const upload = await startUploadFixture()
  try {
    const original = join(originals, '原始文档.pdf')
    await writeFile(original, 'example')
    const answer = `[下载报告](https://files.example.test/delivery)\n原文件保留在：\`${original}\``
    const h = await fixture([tool('deliver_file', 0, { path: 'report.pdf' }), text(answer)], { fileUpload: {
      enabled: true, url: upload.url, businessKey: 'zhjl', maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
    } })
    const { metadata } = await seedDeliveryFile(h.root)
    const response = await h.send({ stream, metadata })
    const body = await response.text()
    expect(response.status, body).toBe(200)
    expect(body).toContain('https://files.example.test/delivery')
    expect(stream ? answerFragments(body).join('') : body).toContain(original)
    expect(body).not.toContain('FILE_UPLOAD_FAILED')
    expect(upload.count()).toBe(1)
    if (stream) expect(body).toContain('data: [DONE]')
  } finally {
    await upload.close()
    await rm(originals, { recursive: true, force: true })
  }
})

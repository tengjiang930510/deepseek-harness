import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { SessionId } from '@deepseek-ai/dsh-session'
import WebRuntime from '@deepseek-ai/dsh-web'
import { BailianSearchProvider, mapBailianSources } from '../src/provider.ts'
import * as bailianPlugin from '../src/index.ts'

const options = {
  apiKey: 'test-key',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  baseURL: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  model: 'deepseek-v4.1-flash',
}

function result(output: unknown[]): Response {
  return new Response(JSON.stringify({ status: 'completed', output }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('Bailian Responses search', () => {
  it('collects distinct source URLs across web search calls', () => {
    expect(mapBailianSources({ status: 'completed', output: [
      { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }, { type: 'url', url: 'https://b.test' }] } },
      { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } },
    ] })).toEqual({ sources: [{ url: 'https://a.test' }, { url: 'https://b.test' }], truncated: false })
  })

  it('passes the generated answer and its search sources to web_search', () => {
    expect(mapBailianSources({ status: 'completed', output: [
      { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://weather.example/forecast' }] } },
      { type: 'message', content: [
        { type: 'output_text', text: '武汉今天最高气温 28°C。' },
        { type: 'output_text', text: '傍晚有阵雨。' },
      ] },
    ] })).toEqual({
      content: '武汉今天最高气温 28°C。\n\n傍晚有阵雨。',
      sources: [{ url: 'https://weather.example/forecast' }],
      truncated: false,
    })
  })

  it('forces the built-in search and records the secret-free request before dispatch', async () => {
    const fetchMock = vi.fn(async (_endpoint: string, _init: RequestInit) => result([
      { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } },
    ]))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new BailianSearchProvider(() => ({ ...options, recordRequest }))
    await expect(provider.search({ query: 'latest news' })).resolves.toMatchObject({ sources: [{ url: 'https://a.test' }] })
    const call = fetchMock.mock.calls[0]
    if (call === undefined) throw new Error('expected fetch call')
    const [endpoint, init] = call
    expect(endpoint).toBe(`${options.baseURL}/responses`)
    expect(init.redirect).toBe('error')
    if (typeof init.body !== 'string') throw new Error('expected JSON request body')
    const sentBody: unknown = JSON.parse(init.body)
    expect(sentBody).toEqual({
      model: 'deepseek-v4.1-flash',
      input: 'Search the web for: latest news',
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
    })
    expect(recordRequest).toHaveBeenCalledWith({ endpoint, body: sentBody })
    expect(recordRequest.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
    expect(JSON.stringify(recordRequest.mock.calls)).not.toContain('test-key')
  })

  it('rejects a completed response without source URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => result([{ type: 'message', content: [{ type: 'output_text', text: 'uncited' }] }])))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('forwards cancellation to the HTTP request', async () => {
    const fetchMock = vi.fn(async (_endpoint: string, _init: RequestInit) => result([{ type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } }]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new BailianSearchProvider(() => options).search({ query: 'news' }, controller.signal)
    const call = fetchMock.mock.calls[0]
    if (call === undefined) throw new Error('expected fetch call')
    const [, init] = call
    expect(init.signal).toBe(controller.signal)
  })

  it('routes a selected web search through the plugin and removes it on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => result([
      { type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } },
    ])))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'bailian-responses' })
    const fiber = await ctx.plugin(bailianPlugin, options)
    await expect(ctx.web.search({ query: 'news' })).resolves.toMatchObject({ sources: [{ url: 'https://a.test' }] })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'news' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('rejects an insecure endpoint before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new BailianSearchProvider(() => ({ ...options, baseURL: 'http://example.test/v1' })).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects incomplete responses and source lists without usable URLs', () => {
    for (const payload of [
      null,
      { status: 'incomplete', output: [] },
      { status: 'completed', output: {} },
      { status: 'completed', output: [null, {}, { type: 'web_search_call' }] },
      { status: 'completed', output: [{ type: 'web_search_call', action: { sources: [null, [], {}, { type: 'file', url: 'https://a.test' }, { type: 'url', url: 'https://' }, { type: 'url', url: 'file:///tmp/a' }] } }] },
    ]) {
      expect(() => mapBailianSources(payload)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    }
  })

  it('uses a credential resolver and reports a missing credential', async () => {
    const resolveApiKey = vi.fn(async () => 'resolved-key')
    const fetchMock = vi.fn(async (_endpoint: string, _init: RequestInit) => result([{ type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } }]))
    vi.stubGlobal('fetch', fetchMock)
    await new BailianSearchProvider(() => ({ ...options, apiKey: '', resolveApiKey })).search({ query: 'news' })
    expect(resolveApiKey).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer resolved-key' } })
    await expect(new BailianSearchProvider(() => ({ ...options, apiKey: '' })).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('classifies credential resolution failures and cancellation', async () => {
    const error = new Error('credential store failed')
    await expect(new BailianSearchProvider(() => ({ ...options, apiKey: '', resolveApiKey: async () => { throw error } })).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    const controller = new AbortController()
    controller.abort('cancelled')
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('classifies fetch, JSON, and HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('broken JSON')))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toThrow('bad request')
  })

  it('classifies cancellation during fetch and body reading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new DOMException('cancelled', 'AbortError') } })))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('rejects invalid plugin settings before registering the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'bailian-responses' })
    for (const config of [
      { ...options, baseURL: 'not a URL' },
      { ...options, baseURL: 'http://example.test/v1' },
      { ...options, model: '' },
    ]) {
      await expect(ctx.plugin(bailianPlugin, config)).rejects.toThrow('requires an HTTPS baseURL')
    }
  })

  it('resolves the launch environment credential when no credential service is mounted', async () => {
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { BAILIAN_TEST_KEY: 'environment-key' } },
    ]))
    await ctx.plugin(WebRuntime, { searchProvider: 'bailian-responses' })
    await ctx.plugin(bailianPlugin, { apiKeyEnv: 'BAILIAN_TEST_KEY', baseURL: options.baseURL, model: options.model })
    const fetchMock = vi.fn(async (_endpoint: string, _init: RequestInit) => result([{ type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } }]))
    vi.stubGlobal('fetch', fetchMock)
    await ctx.web.search({ query: 'news' })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer environment-key' } })
  })

  it('records an auxiliary request under the initiating agent', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'bailian-responses' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(bailianPlugin, options)
    vi.stubGlobal('fetch', vi.fn(async () => result([{ type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } }])))
    const append = vi.fn()
    const agent = { id: SessionId('bailian-test-agent') } as Agent
    Object.assign(agent, { session: { append } })
    await ctx.agents.withInitiator(agent, () => ctx.web.search({ query: 'news' }))
    expect(append).toHaveBeenCalledWith('web/bailian-search-llm-request', expect.objectContaining({
      endpoint: `${options.baseURL}/responses`,
    }))
  })

  it('reads a rotated credential from the mounted credential service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-bailian-credentials-'))
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'bailian-responses' })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(bailianPlugin, { apiKeyEnv: options.apiKeyEnv, baseURL: options.baseURL, model: options.model })
      const fetchMock = vi.fn(async (_endpoint: string, _init: RequestInit) => result([{ type: 'web_search_call', action: { sources: [{ type: 'url', url: 'https://a.test' }] } }]))
      vi.stubGlobal('fetch', fetchMock)
      await ctx.credentials.set(credentialRef(options.apiKeyEnv), 'stored-key')
      await ctx.web.search({ query: 'news' })
      await ctx.credentials.set(credentialRef(options.apiKeyEnv), 'rotated-key')
      await ctx.web.search({ query: 'news' })
      const headers = fetchMock.mock.calls.map(([, init]) => new Headers(init.headers))
      expect(headers.map(header => header.get('authorization'))).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('checks cancellation after credential resolution and request recording', async () => {
    const first = new AbortController()
    await expect(new BailianSearchProvider(() => ({
      ...options, apiKey: '', resolveApiKey: async () => { first.abort('cancelled'); return 'key' },
    })).search({ query: 'news' }, first.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    const second = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new BailianSearchProvider(() => ({
      ...options, recordRequest: () => { second.abort('cancelled') },
    })).search({ query: 'news' }, second.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves an abort during credential resolution failure', async () => {
    const controller = new AbortController()
    await expect(new BailianSearchProvider(() => ({
      ...options, apiKey: '', resolveApiKey: async () => { controller.abort('cancelled'); throw new Error('store failed') },
    })).search({ query: 'news' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('reports HTTP errors with top-level or absent messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'top-level error' }), { status: 400 })))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' })).rejects.toThrow('top-level error')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(new BailianSearchProvider(() => options).search({ query: 'news' })).rejects.toThrow('HTTP 500')
  })
})

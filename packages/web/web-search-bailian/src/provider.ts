/** Bailian Responses search backed by the model's built-in web_search tool. */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-session'

/** Stable provider id used by `web.searchProvider`. */
export const BAILIAN_SEARCH_PROVIDER_ID = 'bailian-responses'

/** Request fields recorded before a search dispatch; credentials are excluded. */
export interface BailianSearchLlmRequest {
  readonly endpoint: string
  readonly body: {
    readonly model: string
    readonly input: string
    readonly tools: readonly [{ readonly type: 'web_search' }]
    readonly tool_choice: 'required'
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Auxiliary Bailian search request recorded before dispatch. */
    'web/bailian-search-llm-request': BailianSearchLlmRequest
  }
}

/** Options resolved at the start of one search operation. */
export interface BailianSearchProviderOptions {
  readonly apiKey?: string
  readonly resolveApiKey?: () => Promise<string | undefined>
  readonly apiKeyEnv: string
  readonly baseURL: string
  readonly model: string
  readonly recordRequest?: (request: BailianSearchLlmRequest) => void
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

function validBaseURL(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === 'https:'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Convert the generated answer and structured web_search_call URLs into a search result.
 * @param payload - parsed Responses API body.
 * @returns the generated answer and distinct URL-only sources in provider order.
 */
export function mapBailianSources(payload: unknown): WebSearchResult {
  const response = record(payload)
  if (response?.['status'] !== 'completed' || !Array.isArray(response['output'])) {
    throw new WebError('Bailian search returned an incomplete response', 'WEB_PROVIDER_ERROR')
  }
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  const answer: string[] = []
  for (const item of response['output']) {
    const call = record(item)
    if (call?.['type'] === 'message' && Array.isArray(call['content'])) {
      for (const part of call['content']) {
        const content = record(part)
        if (content?.['type'] === 'output_text' && typeof content['text'] === 'string' && content['text'].length > 0) {
          answer.push(content['text'])
        }
      }
    }
    if (call?.['type'] !== 'web_search_call') continue
    const items = record(call['action'])?.['sources']
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const source = record(item)
      const url = source?.['url']
      if (source?.['type'] !== 'url' || typeof url !== 'string' || !URL.canParse(url) || !/^https?:\/\//u.test(url) || seen.has(url)) continue
      seen.add(url)
      sources.push({ url })
    }
  }
  if (sources.length === 0) {
    throw new WebError('Bailian returned no web_search_call source URLs', 'WEB_PROVIDER_ERROR')
  }
  return { ...answer.length > 0 ? { content: answer.join('\n\n') } : {}, sources, truncated: false }
}

/** Search through Bailian's OpenAI-compatible Responses API. */
export class BailianSearchProvider implements WebSearchProvider {
  readonly id = BAILIAN_SEARCH_PROVIDER_ID

  constructor(private readonly resolveOptions: () => BailianSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return (Boolean(options.apiKey) || options.resolveApiKey !== undefined)
      && validBaseURL(options.baseURL)
      && options.model.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    if (isAborted(signal)) throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: signal?.reason })
    if (!validBaseURL(options.baseURL) || options.model.length === 0) {
      throw new WebError('Bailian search requires an HTTPS baseURL and non-empty model', 'WEB_PROVIDER_ERROR')
    }
    let apiKey: string | undefined
    try {
      apiKey = options.apiKey || await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (isAborted(signal)) throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Bailian search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (isAborted(signal)) throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: signal?.reason })
    if (!apiKey) throw new WebError(`Bailian search has no API key for "${options.apiKeyEnv}"`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    const endpoint = `${options.baseURL.replace(/\/$/u, '')}/responses`
    const body: BailianSearchLlmRequest['body'] = {
      model: options.model,
      input: `Search the web for: ${request.query}`,
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
    }
    options.recordRequest?.({ endpoint, body })
    if (isAborted(signal)) throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: signal?.reason })
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (isAborted(signal) || error instanceof DOMException && error.name === 'AbortError') {
        throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(`Bailian search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error: unknown) {
      if (isAborted(signal) || error instanceof DOMException && error.name === 'AbortError') {
        throw new WebError('Bailian search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError('Bailian search returned invalid JSON', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      const error = record(record(payload)?.['error'])
      const message = error?.['message'] ?? record(payload)?.['message']
      throw new WebError(`Bailian API error (HTTP ${response.status})${typeof message === 'string' ? `: ${message}` : ''}`, 'WEB_PROVIDER_ERROR')
    }
    return mapBailianSources(payload)
  }
}

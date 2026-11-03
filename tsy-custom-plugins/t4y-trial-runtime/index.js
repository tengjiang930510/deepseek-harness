/**
 * Qwen-backed web search for ctx.web.
 *
 * Mirrors `@deepseek-ai/dsh-web-search-deepseek`: one auxiliary model turn with a
 * native server-side web_search tool, structured source mapping, no prose scraping.
 * DeepSeek uses Anthropic Messages + `web_search_20250305`; Qwen on this deployment
 * uses the OpenAI-compatible Responses API + `tools: [{ type: 'web_search' }]`
 * (thinking mode rejects `tool_choice`).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runtime } from './runtime.js'

export const name = 't4y-trial-runtime'
export const inject = ['web']

/** Drop profile rows that would reselect DeepSeek search or override this bundle's web pin. */
const PROFILE_OWNED_IDS = new Set(['web', 'web-search-deepseek'])

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/**
 * Map a Qwen Responses payload to WebSearchResult the same way DeepSeek maps
 * `web_search_tool_result` blocks: structured sources only, never model prose as `content`.
 */
function mapQwenResponse(payload) {
  const response = record(payload)
  if (response?.status !== 'completed' || !Array.isArray(response.output)) {
    throw new Error('Qwen search returned an incomplete response; native web search may not have run')
  }
  const seen = new Set()
  const sources = []
  for (const item of response.output) {
    const output = record(item)
    if (output?.type !== 'web_search_call') continue
    const sourcesList = record(output.action)?.sources
    if (!Array.isArray(sourcesList)) continue
    for (const source of sourcesList) {
      const row = record(source)
      const url = row?.url
      if (typeof url !== 'string' || !/^https?:\/\//u.test(url) || !URL.canParse(url) || seen.has(url)) continue
      seen.add(url)
      const title = typeof row.title === 'string' && row.title.length > 0 ? row.title : undefined
      sources.push(title === undefined ? { url } : { url, title })
    }
  }
  if (sources.length === 0) {
    throw new Error('Qwen returned no web_search_call sources; the request may not have triggered native web search')
  }
  return { sources, truncated: false }
}

class QwenSearchProvider {
  constructor(ctx, options) {
    this.ctx = ctx
    this.id = options.searchProvider
    this.credentialRef = options.credentialRef
    this.baseURL = options.baseURL
    this.model = options.model
    this.maxTokens = options.maxTokens
  }

  available() {
    if (!URL.canParse(this.baseURL)) return false
    const protocol = new URL(this.baseURL).protocol
    return (protocol === 'https:' || protocol === 'http:')
      && this.model.length > 0
      && Number.isInteger(this.maxTokens)
      && this.maxTokens > 0
  }

  async search(request, signal) {
    const credential = await this.ctx.get('credentials')?.resolve(this.credentialRef)
    const apiKey = credential?.value ?? process.env[this.credentialRef]
    if (!apiKey) {
      throw new Error(
        `Qwen search has no API key for "${this.credentialRef}"; store it through the credentials service `
        + 'or export it in the launching environment',
      )
    }
    const endpoint = `${this.baseURL.replace(/\/$/u, '')}/responses`
    // Parallel to DeepSeek's Messages body with web_search_20250305 — Qwen Responses + web_search.
    // Do not send tool_choice: required (thinking mode returns HTTP 400).
    const body = {
      model: this.model,
      input: `Perform a web search for the query: ${request.query}`,
      max_output_tokens: this.maxTokens,
      tools: [{ type: 'web_search' }],
    }
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new Error('Qwen search aborted', { cause: error })
      }
      throw new Error(`Qwen search request failed: ${String(error)}`, { cause: error })
    }
    const payload = await response.json()
    if (!response.ok) {
      const message = record(record(payload)?.error)?.message ?? record(payload)?.message
      throw new Error(
        `Qwen API error (HTTP ${response.status})${typeof message === 'string' ? `: ${message}` : ''}\n\n`
        + `The web search request used endpoint ${JSON.stringify(endpoint)}. `
        + 'Search endpoint configuration is separate from chat.',
      )
    }
    return mapQwenResponse(payload)
  }
}

function splitTopLevelItems(source) {
  const lines = source.replace(/^\uFEFF/, '').split('\n')
  const items = []
  let current = []
  for (const line of lines) {
    if (line.startsWith('- ') && current.length > 0) {
      items.push(current.join('\n'))
      current = [line]
      continue
    }
    if (line.startsWith('- ') || current.length > 0) current.push(line)
  }
  if (current.length > 0) items.push(current.join('\n'))
  return items
}

function itemId(item) {
  return item.match(/^- id:\s*([^\s#]+)\s*$/m)?.[1]
}

/** Drop legacy profile rows so this bundle owns search selection and DeepSeek search stays off. */
function migrateProfilePatch(profileDir) {
  if (typeof profileDir !== 'string' || profileDir.length === 0) return false
  const path = join(profileDir, 'cordis.patch.yml')
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  const trimmed = source.trim()
  if (trimmed === '' || trimmed === '[]') return false
  const kept = splitTopLevelItems(source).filter(item => {
    const id = itemId(item)
    return id === undefined || !PROFILE_OWNED_IDS.has(id)
  })
  const next = kept.length === 0 ? '[]\n' : `${kept.join('\n').replace(/\n+$/u, '')}\n`
  if (next === source) return false
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.t4y-trial-runtime.tmp`
  writeFileSync(temporary, next)
  renameSync(temporary, path)
  return true
}

/**
 * @param {*} ctx
 * @param {{
 *   searchProvider?: string,
 *   credentialRef?: string,
 *   baseURL?: string,
 *   model?: string,
 *   maxTokens?: number,
 * }} [config]
 */
export function apply(ctx, config = {}) {
  migrateProfilePatch(ctx.get('profileContext')?.dir)
  const options = {
    searchProvider: typeof config.searchProvider === 'string' && config.searchProvider !== ''
      ? config.searchProvider
      : runtime.searchProvider,
    credentialRef: typeof config.credentialRef === 'string' && config.credentialRef !== ''
      ? config.credentialRef
      : runtime.credentialRef,
    baseURL: typeof config.baseURL === 'string' && config.baseURL !== ''
      ? config.baseURL.replace(/\/$/u, '')
      : runtime.baseURL,
    model: typeof config.model === 'string' && config.model !== ''
      ? config.model
      : runtime.model,
    maxTokens: Number.isInteger(config.maxTokens) && config.maxTokens > 0
      ? config.maxTokens
      : runtime.maxTokens,
  }
  ctx.web.registerSearchProvider(new QwenSearchProvider(ctx, options))
}

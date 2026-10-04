/** Register Bailian Responses web search in `ctx.web`. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import { BailianSearchProvider } from './provider.ts'
import type { BailianSearchProviderOptions } from './provider.ts'

export { BailianSearchProvider, BAILIAN_SEARCH_PROVIDER_ID, mapBailianSources } from './provider.ts'
export type { BailianSearchLlmRequest, BailianSearchProviderOptions } from './provider.ts'

/** Cordis plugin name. */
export const name = 'web-search-bailian'

/** Web service that receives this provider. */
export const inject = ['web']

/** Search request settings. `baseURL` is the OpenAI-compatible `/v1` base. */
export interface Config {
  /** Credential reference resolved for every request. */
  apiKeyEnv: Volatile<string>
  /** Optional literal credential; prefer `apiKeyEnv`. */
  apiKey: Volatile<string | undefined>
  /** Bailian OpenAI-compatible base URL ending in `/v1`. */
  baseURL: Volatile<string>
  /** Bailian model for the auxiliary search request. */
  model: Volatile<string>
}

export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default('DASHSCOPE_API_KEY').volatile(),
  apiKey: z.string().role('secret').volatile(),
  baseURL: z.string().volatile(),
  model: z.string().volatile(),
})

/** Register the provider with operation-local settings and credential resolution. */
export function apply(ctx: Context, config: Config): void {
  const options = (): BailianSearchProviderOptions => {
    const apiKeyEnv = credentialRef(config.apiKeyEnv.get())
    const apiKey = config.apiKey.get()
    return {
      ...apiKey === undefined ? {} : { apiKey },
      apiKeyEnv,
      baseURL: config.baseURL.get(),
      model: config.model.get(),
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
      },
      recordRequest: (request) => {
        ctx.get('agents')?.currentInitiator()?.session.append('web/bailian-search-llm-request', request)
      },
    }
  }
  const initial = options()
  if (!URL.canParse(initial.baseURL) || new URL(initial.baseURL).protocol !== 'https:' || initial.model.length === 0) {
    throw new Error('web-search-bailian requires an HTTPS baseURL and non-empty model')
  }
  ctx.web.registerSearchProvider(new BailianSearchProvider(options))
}

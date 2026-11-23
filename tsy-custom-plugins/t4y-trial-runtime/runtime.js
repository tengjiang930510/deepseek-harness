/** Product settings owned by this plugin release (Qwen stand-in for DeepSeek native search). */
export const runtime = Object.freeze({
  /** Same selection role as DeepSeek's `deepseek-official`, owned by this plugin. */
  searchProvider: 't4y-qwen-search',
  /** Uses the same per-user New API key issued at enterprise login. */
  credentialRef: 'T4Y_NEW_API_KEY',
  /** OpenAI-compatible `/v1` base; `/responses` is appended for native web_search. */
  baseURL: 'https://jgyw.crfsdi.com.cn:50000/whdt/proxy/t4y_new_api/v1',
  /** Native Responses web_search is validated on Flash through the New API proxy. */
  model: 'qwen3.8-flash',
  maxTokens: 4096,
})

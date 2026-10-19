/** Product settings owned by this plugin release (Qwen stand-in for DeepSeek native search). */
export const runtime = Object.freeze({
  /** Same selection role as DeepSeek's `deepseek-official`, owned by this plugin. */
  searchProvider: 't4y-qwen-search',
  credentialRef: 'T4Y_QWEN_API_KEY',
  /** OpenAI-compatible `/v1` base; `/responses` is appended for native web_search. */
  baseURL: 'https://llm-7d9gw5u5aum1zav9.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.8-flash',
  maxTokens: 4096,
})

---
kind: upgrade-guide
description: Source OpenAI profiles use the project Qwen route and expanded tools by default.
---

# OpenAI source profile defaults

English | [中文](guide.zh.md)

## Change

The source OpenAI profile defaults to `qwen-token-plan / deepseek-v4.1-flash` from the project model-defaults bundle and reads `QWEN_TOKEN_PLAN_API_KEY`. Its default tool list includes Bash, web search and fetch, Bilibili search, Office workflow preparation, and leave submission. Explicit profile model lists still replace these defaults.

## Migration

Set `QWEN_TOKEN_PLAN_API_KEY` in the target checkout's local `.env`. To retain the DeepSeek official route, set `OPENAI_SERVICE_PROVIDER=deepseek-official` and `OPENAI_SERVICE_MODEL` to your supported model ID. Exported `DSH_OPENAI_PROVIDER` and `DSH_OPENAI_MODEL` take precedence. Set an explicit `models[].tools` list in the profile patch to control tool access. Restart `pnpm dsh openai` after updating configuration.

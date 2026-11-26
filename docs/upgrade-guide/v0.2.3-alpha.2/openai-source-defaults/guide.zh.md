---
kind: upgrade-guide
description: 源码 OpenAI profile 默认使用项目的千问路由和扩展工具列表。
---

# OpenAI 源码 profile 默认配置

[English](guide.md) | 中文

## 变更

源码 OpenAI profile 默认使用项目 model-defaults 组合包中的 `qwen-token-plan / deepseek-v4.1-flash`，读取 `QWEN_TOKEN_PLAN_API_KEY`。默认工具列表包含 Bash、网页搜索与解析、B 站搜索、Office 工作流准备和请假提交。profile 显式设置的模型列表仍会替换这些默认值。

## 迁移

在目标检出的本地 `.env` 中设置 `QWEN_TOKEN_PLAN_API_KEY`。如需继续使用 DeepSeek 官方路由，设置 `OPENAI_SERVICE_PROVIDER=deepseek-official`，并将 `OPENAI_SERVICE_MODEL` 设为受支持的模型 ID。启动环境导出的 `DSH_OPENAI_PROVIDER` 和 `DSH_OPENAI_MODEL` 优先。可在 profile patch 中显式设置 `models[].tools` 列表以控制工具权限。更新配置后重启 `pnpm dsh openai`。

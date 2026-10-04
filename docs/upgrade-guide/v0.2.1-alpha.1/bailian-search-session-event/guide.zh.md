---
kind: upgrade-guide
description: "记录百炼搜索的会话现在包含必需的 web/bailian-search-llm-request 事件，旧版读取器会拒绝。"
---

# 百炼搜索会写入必需的会话事件

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-web-search-bailian` 在每次辅助 Responses 搜索发送前追加 `web/bailian-search-llm-request`。载荷是 HTTPS 端点和不含密钥的 JSON 请求体（`model`、`input`、`tools`、`tool_choice`）。请求头和凭据不会写入。该事件在读取时必需：包含它的 Session 会被不认识该类型的读取器拒绝。从未运行百炼搜索的 Session 仍然有效。

base bundle 仍将 `web.searchProvider` 固定为 `deepseek-official`，并以禁用状态附带百炼插件。必须通过 profile patch 启用插件、设置 `baseURL` 和 `model`，并固定 `searchProvider: bailian-responses`，之后才会写入这些事件。

## 迁移

1. 在回放使用过百炼搜索的 Session 之前，先升级读取器（本 checkout 或更新发行）。确认 [`packages/core/session/src/known-event-types.ts`](../../../../packages/core/session/src/known-event-types.ts) 中列出 `web/bailian-search-llm-request`。
2. 不含该事件的 Session 可继续用旧读取器。不要把百炼 Session 复制到升级前的 checkout。
3. 要开始写入该事件，在 profile patch 中启用插件，并按 [`packages/web/web-search-bailian/README.zh.md`](../../../../packages/web/web-search-bailian/README.zh.md) 固定 `web.searchProvider: bailian-responses`。
4. 确认有发起智能体的搜索会追加该事件且不含 API 密钥，然后用本 checkout 的读取器打开该 Session。

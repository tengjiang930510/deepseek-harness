---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-bailian-search-request

[English](2026-10-04-bailian-search-request.md) | 中文

## 概述

新增读取时必需的会话事件 web/bailian-search-llm-request，记录百炼 Responses 辅助搜索。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-bailian-search-request
baseline: false
changes:
  - root: "event:web/bailian-search-llm-request"
    previous: null
    after: "95d60acfcdeb2b92ee667b2a75a3f5879a41208dd29a06add98a8a1d7aed3c99"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 Session 仍然有效。不认识该类型的读取器会拒绝包含它的 Session。载荷是 HTTPS 端点和不含密钥的请求体；凭据不会写入。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/web/web-search-bailian：提供方测试覆盖发送前的无密钥记录、来源映射、凭据解析和取消。

<a id="dev-note"></a>
## 开发备注

无。

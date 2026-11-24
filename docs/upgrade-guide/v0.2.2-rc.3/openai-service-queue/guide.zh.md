---
kind: upgrade-guide
description: "自定义 OpenAI 服务在执行名额用尽时等待空闲名额。"
---

# OpenAI 服务队列

[English](guide.md) | 中文

## 变更

自定义 `t4y-openai-service` 在执行名额用尽时原先返回 `429 CAPACITY`。现在，多出的合法请求会保持 HTTP 连接并排队。等待上限由 `queueTimeoutMs` 设置，默认 30 分钟。执行开始前等待超时会返回 `504 QUEUE_TIMEOUT`。

## 迁移

1. 将依赖 `429 CAPACITY` 的客户端更新为处理 `504 QUEUE_TIMEOUT`。如需立即返回容量不足，调用方可自行限制提交量。
2. 设置 HTTP 客户端或代理超时的时候，同时考虑排队等待和 `requestTimeoutMs`。在执行名额用尽时发出请求，确认它会在腾出名额后开始执行。

---
kind: upgrade-guide
description: "The custom OpenAI service waits for an execution slot when all slots are busy."
---

# OpenAI service queue

English | [中文](guide.zh.md)

## Change

The custom `t4y-openai-service` previously returned `429 CAPACITY` when all execution slots were busy. Extra validated requests now wait with the HTTP connection open. The wait lasts up to `queueTimeoutMs` (30 minutes by default) and ends with `504 QUEUE_TIMEOUT` if it expires before execution begins.

## Migration

1. Update callers that rely on `429 CAPACITY` to handle `504 QUEUE_TIMEOUT`. If callers must receive immediate overload responses, cap submissions in the caller.
2. When setting HTTP client or proxy timeouts, budget for the queue wait as well as `requestTimeoutMs`. Verify that a request sent while all slots are busy starts after a slot becomes available.

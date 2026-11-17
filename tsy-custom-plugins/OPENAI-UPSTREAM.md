---
description: "Review required Harness extension points when upgrading the custom OpenAI service and API history UI."
---

# OpenAI plugin upstream compatibility

English | [中文](OPENAI-UPSTREAM.zh.md)

## Summary

The custom [service](t4y-openai-service/README.md) and [API history UI](t4y-openai-ui/README.md) depend on a small set of generic Harness additions. The [review baseline](upstream-baseline.json) records the checkout version used to assess those additions. It is a review reference, not a runtime version lock or a promise that unmodified upstream releases are compatible.

## Required Harness support

| Area | Required behavior | Upgrade review |
|---|---|---|
| `AgentOptions.configureCall` | Per-Agent request controls enter the prepared request and durable request header before dispatch. | Preserve `temperature` and `stop` logging, request isolation, retry accounting, and the prepared-call checks. Do not move control changes to `llm/stream` or add listeners to deprecated `agent/request`. |
| JSONL `checkpointLive` | A flush racing with close joins that close and reports its failure. | Preserve drain ordering and failure propagation. Keep the regression in the JSONL provider; a custom plugin cannot safely replace its private writer lifecycle. |
| Read-only Session access | Configured prefixes select history-only access; read and refresh do not activate an Agent or acquire its writer lock. Server mutations reject read-only Sessions. | Review `readOnlySessionIdPrefixes`, wire `readOnly`, retained history refresh, RPC guards, and inactive Session loading together. |
| Generic client slots | Session row badges and read-only header actions/utilities accept plugin contributions. | Preserve slot declarations, locale ownership, disposal, and suppression of input, feedback, branch, and mutation controls. API text and blue styling remain in the custom UI bundle. |

These changes are generic upstream review items. The custom bundles own HTTP routing, OpenAI validation, SSE CRLF frames, public progress, model budgets, conversation identity, API prefixes, labels, and profile registration. Do not remove `session.lock`: API execution remains the writer while the UI reads durable history.

## Upgrade checklist

1. Compare the candidate upstream checkout with the linked baseline and review every required behavior above. Keep or rebase only support that upstream does not yet provide.
2. Preserve durable `openai-` Session ids and the public model alias plus conversation-id mapping. Moving package files must not create a second conversation namespace. `readOnly` is transient remote metadata, not a new persisted Session-header field.
3. Build the candidate checkout, then run the focused commands below. Repeat the recorded test with source launch when changing the CLI or package resolution.
4. Verify that an API turn can run while its history is open in Web, and that refreshing displays newly persisted turns. Read-only classification provides no user authentication or tenant isolation.

```sh
git rev-parse HEAD
pnpm run build
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs
DSH_EXAMPLE_MODE=src node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs -t "resumes one conversation over HTTP"
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --ui
node --test tsy-custom-plugins/t4y-openai-ui/tests/client.test.mjs
pnpm exec vitest run packages/core/agent-loop/tests/call-controls.spec.ts packages/session/session-persistence-jsonl/tests/jsonl.spec.ts
```

The browser command needs current Web artifacts and Chromium. Live provider verification is separate: add `--live` to the service runner when credentials are available. No check here requires restarting a user-owned service or accessing the real DSH home.

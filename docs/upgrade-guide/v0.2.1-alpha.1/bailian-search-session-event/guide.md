---
kind: upgrade-guide
description: "Sessions that record Bailian search now include a required web/bailian-search-llm-request event that older readers refuse."
---

# Bailian search logs a required session event

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-web-search-bailian` appends `web/bailian-search-llm-request` immediately before each auxiliary Responses search. The payload is the HTTPS endpoint and the secret-free JSON body (`model`, `input`, `tools`, `tool_choice`). Headers and credentials are not stored. The event is required on read: a Session that contains it is refused by a reader that does not know the type. Sessions that never ran Bailian search remain valid.

The base bundle still pins `web.searchProvider` to `deepseek-official` and ships the Bailian plugin disabled. A profile patch must enable the plugin, set `baseURL` and `model`, and pin `searchProvider: bailian-responses` before any of these events are written.

## Migration

1. Upgrade the reader (this checkout or a later release) before replaying a Session that used Bailian search. Confirm `web/bailian-search-llm-request` is listed in [`packages/core/session/src/known-event-types.ts`](../../../../packages/core/session/src/known-event-types.ts).
2. Keep older readers on Sessions that do not contain the event. Do not copy a Bailian Session onto a pre-upgrade checkout.
3. To start writing the event, enable the plugin in the profile patch and pin `web.searchProvider: bailian-responses` as shown in [`packages/web/web-search-bailian/README.md`](../../../../packages/web/web-search-bailian/README.md).
4. Confirm a search under an initiating agent appends the event without the API key, then open the Session with this checkout's reader.

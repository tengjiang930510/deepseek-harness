---
description: "Use Bailian Responses API search results in the DSH web_search tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-bailian

English | [中文](README.zh.md)

## Summary

This package searches through Bailian's OpenAI-compatible Responses API and passes the generated answer and structured source URLs to DSH's `web_search` tool. It can use the same Alibaba API credential and model as chat, including `deepseek-v4.1-flash`. Each search makes a separate, billable model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

Mount the plugin beside `dsh-web` and select `bailian-responses` as `web.searchProvider`. Supply the OpenAI-compatible `/v1` endpoint for the Alibaba workspace that serves the selected model.

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: bailian-responses
- id: web-search-bailian
  name: '@deepseek-ai/dsh-web-search-bailian'
  disabled: false
  config:
    apiKeyEnv: QWEN_TOKEN_PLAN_API_KEY
    baseURL: https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    model: deepseek-v4.1-flash
```

| Field | Meaning |
|---|---|
| `apiKeyEnv` | Credential reference, resolved for each search; defaults to `DASHSCOPE_API_KEY` |
| `apiKey` | Optional literal API key; a non-empty value takes precedence |
| `baseURL` | HTTPS OpenAI-compatible `/v1` base; `/responses` is appended |
| `model` | Model used for the separate search request |

The provider sends one `web_search` tool declaration with `tool_choice: required`. It collects the generated answer from `message.content[].text` and distinct URLs from `web_search_call.action.sources`, then returns both to `web_search`. A response without structured URLs fails. The source metadata contains URLs only; the tool displays hostname labels. The web service applies its `maxResults` limit after the provider returns.

Credential absence, cancellation, invalid responses, and HTTP failures surface as `WebError`. Redirects are rejected before contacting their target. A search under an initiating agent records the endpoint and secret-free request body in the session log before dispatch.

-----

## Understand the implementation

<details>
<summary>Implementation internals</summary>

[`src/index.ts`](src/index.ts) registers the provider and resolves credentials. [`src/provider.ts`](src/provider.ts) sends the Responses request and maps the generated answer and structured source URLs. No runtime invariant companion is published because the package has no independent mutable state relation.

</details>

-----

## Further Exploration

- [Web subsystem](../../../docs/subsystems/web.md) defines the shared search result and error fields.
- [Web package map](../README.md) lists the providers and consumer.
- [Configuration catalog](../../../docs/config-catalog.md) lists the accepted settings.

-----

## Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>

## Model Experience

### Auxiliary Bailian request

#### What the model sees

The auxiliary Bailian model sees the query prefixed with `Search the web for:`. This request is separate from the conversation model's context.

#### Token effect

The auxiliary request consumes separate tokens and may invoke several internal searches.

#### KV Cache effect

The auxiliary request has its own cache context, independent of the conversation request.

### Conversation tool result

#### What the model sees

The conversation model receives the generated answer and source URLs through DSH's `web_search` tool.

#### Token effect

The generated answer and source URLs consume conversation tokens when the tool result is included in a model request.

#### KV Cache effect

The tool result extends the conversation prefix; it does not change preceding messages.

## Known Limitations and Deferred Work

- The Responses API source list provides URLs without titles or snippets.
- `maxResults` limits DSH output after Bailian has completed its request; it does not cap internal search calls, latency, or provider charges.
- DSH's search timeout may end a request before Bailian returns.

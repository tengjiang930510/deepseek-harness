---
description: "Serve Harness agents through text-only OpenAI Chat Completions, with model aliases, tool allowlists, bounded execution, and FastGPT configuration."
kind: "package-bundle"
---

# t4y-openai-service

English | [中文](README.zh.md)

## Summary

Connect OpenAI-compatible clients such as FastGPT to Harness agents. Each request supplies its text history and receives the committed assistant text after any enabled tools finish. Configure public model aliases, upstream routes, working directories, and explicit tool allowlists. Requests may resume a durable conversation or use independent Sessions; all share the configured execution environment.

## Table of Contents

- [Use this package](#use-this-package)
- [Uploaded file delivery](#uploaded-file-delivery)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This checkout registers the bundle only in the `openai` profile. The CLI initializes that custom profile through its generic profile path; no official OpenAI profile template is required. Build the checkout before launching:

```sh
pnpm run build
pnpm dsh openai
```

The listener defaults to `127.0.0.1:34221`. `DSH_OPENAI_HOST` and `DSH_OPENAI_PORT` override the bind address; `DSH_OPENAI_PROVIDER` and `DSH_OPENAI_MODEL` select the upstream route. The public model alias defaults to `harness`, with a per-call output ceiling of 8192 tokens and an empty tool allowlist. The profile uses existing Harness credentials; a separate `DEEPSEEK_API_KEY` export is unnecessary when its credential provider already resolves the key.

Set deployment overrides in `$DSH_HOME/profiles/openai/cordis.patch.yml` (default home: `~/.dsh`). Target the `openai-server` row and configure `models[].tools` explicitly. The [configuration source](src/config.ts) owns all limits and validation. This bundle adds no application binary: both source and built operation launch through `dsh`.

### HTTP protocol

Each HTTP request permits up to 100 root model steps (`maxSteps`) by default. The per-request cumulative token budget (`maxTotalTokens`) defaults to 10,485,760 reported tokens, including cache reads and writes. It is checked between root model calls; deployments can override it independently of the per-call output limit.

By default both endpoints accept requests without credentials, including clients that send a placeholder Bearer token. Setting `apiKeyEnv` enables authentication: that credential reference is resolved at startup and on every request through the [credential service](../../packages/credentials/credentials/README.md), and both endpoints then require `Authorization: Bearer <service-key>`. `GET /v1/models` returns public aliases. `POST /v1/chat/completions` accepts `model`, `messages`, and optional `stream`; messages contain string content or arrays of text blocks. Leading system messages contribute a literal prompt section alongside Harness instructions. When creating a Session, earlier user and assistant messages enter its log without execution; the final non-blank user message starts the Agent. Native slash commands remain ordinary text. The response header `X-Request-ID` identifies the request diagnostic; `X-DSH-Session-ID` identifies the new or resumed Session.

Generation controls include `temperature`, `stop`, and one of `max_tokens` or `max_completion_tokens`. The output-token control applies to each root conversation-model call and cannot exceed the route ceiling. `n` accepts only 1; `top_p`, frequency penalty, and presence penalty accept only their neutral values. Only text response format and no external tools are supported. Other fields and unsupported values return 400 rather than being ignored; `user` is accepted as client metadata and grants no identity or permissions.

JSON and SSE return final assistant text in `content` and public execution progress in `reasoning_content`, with blank lines between answer messages and line breaks between progress entries. Progress shows `web_search` as `网页搜索` with its search terms and `web_fetch` as `网页解析` with the requested host and path. Available result metadata adds a source count or HTTP status on completion. The URL display omits credentials, query parameters, and fragments. Other tools use their public `description` argument when available, otherwise their name. Each completed invocation adds one compact list row with its outcome and elapsed time; failures include their structured error code. Only calls exceeding `progressDelayMs` (1500 ms by default) add a running notice. Completion reports that the invocation returned, not that it found the requested information. Committed assistant commentary accompanying tool calls also appears in progress. Other tool arguments, raw results, model reasoning, and failed attempts are withheld. SSE frames use CRLF separators so legacy OpenAI SDKs can consume each frame without waiting for another. SSE emits committed commentary and tool events as they occur; assistant messages arrive after their model attempt settles, without token-by-token delivery. The combined answer and progress bytes count toward `maxOutputBytes`. A successful stream ends with a finish-reason chunk and `[DONE]`; `stream_options.include_usage` adds a usage frame. Usage sums reported root conversation calls, including retries and cached input; incomplete reporting omits JSON usage or returns null in the requested SSE usage frame.

### Conversation reuse

New Session ids use the `openai-` namespace, including isolated requests. The optional [API UI bundle](../t4y-openai-ui/README.md) treats this namespace as API-owned and opens it read-only. Older request-isolated Sessions with UUID ids have no durable source label and are not classified automatically.

Send `metadata: {"conversation_id":"your-stable-chat-id"}` to append turns to one durable Session. The id is scoped to the public model alias; different ids or aliases resolve to different Sessions. Without this field, each request creates an independent Session.

The first request imports the supplied text history. Later requests restore the server log, including tool calls and results, and append only the final user message; repeated client history is ignored. Same-conversation requests execute in admission order within one server process, and queued requests observe the normal deadline and cancellation. Agents are released after every request; the next request resumes from persistence, including after a server restart. Live browser and terminal retention remains plugin-owned.

Conversation ids are not authentication or idempotency keys. A retry adds another turn, and edits or deletions in client history do not rewrite the server log. Start a new conversation id to reset or branch context. A changed route workspace or another owner holding the Session returns 409; multiple processes do not share the in-process queue.

### Deployment and failures

Each model route requires an absolute `cwd`, an explicit `tools` allowlist, and an upstream provider/model. Empty allowlists permit no tool execution. Scoped execution guards also reject calls outside that list. All requests using a route share its working directory, credentials, and host resources: separate Sessions are not tenant isolation. Use separate deployments or isolated providers for mutually untrusted callers.

Concurrency, upload bytes, output bytes, elapsed time, root model steps, reported tokens, and response backlog are bounded by configuration. Token budgets are checked between root steps and can overshoot by one call; they exclude auxiliary and descendant calls and are not billing ceilings. Client disconnect, deadline, or plugin unload cancels the owned Agent and awaits disposal. Session persistence follows the composed provider; execution resources are released after each request.

Invalid credentials return 401, unknown aliases 404, capacity or step/token budgets 429, oversized bodies 413, output overflow 502, and deadlines 504. Model or cleanup failures return a redacted 5xx error and a request-linked server diagnostic. After SSE headers, failures use an error frame without a success marker. Tools may already have caused effects; timeout, cancellation, and failure do not roll them back. Do not automatically retry effectful requests.

### FastGPT

Disable FastGPT’s “Hide AI reasoning” option to display execution progress in its reasoning panel.

Add a custom language model whose ID matches a public alias, such as `harness`. Select an OpenAI channel and configure `http://<server>:34221/v1` as its Base URL. Leave the API key empty if the client permits; otherwise use a placeholder while server authentication is disabled. When authentication is enabled, supply the configured service key. A full custom request URL instead uses `http://<server>:34221/v1/chat/completions`. Disable external function calling, multimodal inputs, and structured response formats for this model. FastGPT owns retrieval, workflows, and conversation history; Harness executes its configured tools within each request. Session reuse requires the client to forward a stable conversation id; enabling history alone does not supply it. Never configure one shared literal id for all chats. Match proxy and client timeouts to the deployment deadline.

-----

<a id="uploaded-file-delivery"></a>
## Uploaded file delivery

The plugin Config schema enables `openai-server.fileUpload` by default, including when a profile replaces the entry config with only `models`. It posts multipart fields `businessKey=zhjl-deepseek-harness` and `file` to `https://jgyw.crfsdi.com.cn:51111/backendapi/file/anonymous-upload`; `DSH_FILE_UPLOAD_URL` overrides the endpoint. A successful response must contain HTTP 2xx, numeric `code: 200`, and an HTTP(S) `data.url`. TLS verification stays enabled; uploads are not retried automatically.

Images, PDF, Office documents, ZIP files and other individual files are supported. The original extension is preserved with a unique upload filename, and MIME comes from the file extension. Validated defaults in `src/file-delivery-config.ts` allow at most 8 distinct files per answer, 20 MiB per file, 30 seconds per upload, and a 64 KiB upload response. To disable publication, override `fileUpload: { enabled: false }`; partial upload settings inherit the remaining validated defaults. Explicit `enabled: false` is preserved. Endpoint environment defaults are read when the plugin module loads; restart after changing them.

When uploads are enabled, each API Agent receives the scoped `deliver_file` tool automatically, in addition to the route's global-tool allowlist. Call it with `{"path":"report.pdf"}` after creating the file. It returns confirmed `name`, `url`, `size`, and `mediaType` values through the normal persisted `tool/result` record, so the model can use the real URL in its answer. Disabled uploads expose no delivery tool. The system guidance directs models to this tool rather than starting a local download server.

The reusable `FileDelivery` component and `fileDeliveryConfig` validator are exported from `t4y-openai-service/file-delivery` for plugins running inside a Harness profile. Construct one component per request, await `deliver(path, signal?)`, and close it with `await using` or `Symbol.asyncDispose` to cancel and drain accepted work. The tool and Markdown adapter share that component. Identical resolved paths and bytes reuse one publication, changed bytes require a new publication, and failed publications of unchanged bytes are not retried within the request. Different versions count against the same file budget.

Final Markdown file links, image destinations, reference definitions, and inline-code paths remain a compatibility fallback and use the same component. Web links, fenced code, directories, and outside-workspace inline-code path descriptions are unchanged. Explicit delivery-tool paths and Markdown file destinations still enforce workspace confinement. File targets must resolve within the model route's `cwd`, including symlink targets. Prefer URLs confirmed by `deliver_file`; use Markdown images for previews. Plain prose naming a file cannot reliably identify a fallback delivery. Directory contents are not automatically packaged or uploaded.

While files upload, the response emits public progress; final text is withheld until all referenced files are confirmed. Tool failures record `FILE_UPLOAD_FAILED` without a confirmed URL; fallback failures return that code through the HTTP error envelope. Earlier uploads may already exist remotely; cancellation does not delete them. Local originals are always retained. Explicit tool publications persist their URL in the tool transcript; compatibility conversion retains the assistant's original local references in the Session and substitutes URLs only in this HTTP response. Retention and access to the returned URLs belong to the external file service; the client browser must be able to reach it.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The HTTP plugin owns admission and cancellation. Its request runner creates or resumes an Agent with server-owned controls and observes new root Session events until whole-Agent idle. Committed assistant settlements supply both output and accounting. Agent disposal precedes successful response completion; unloading removes routes, aborts accepted requests, and drains their cleanup.

</details>

### Verification

Run these commands from the repository root. The default suite includes unit tests and the keyless recorded HTTP conversation; `--live` additionally enables credential-gated provider tests. The opt-in browser suite requires current Web build artifacts and Chromium.

```sh
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --live
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --ui
```

Profile fixtures use an isolated `DSH_HOME`, an explicit local manifest dependency, and the real `dsh` CLI. `DSH_EXAMPLE_MODE=src` selects source launch; the default `lib` mode requires current checkout artifacts. Repository paths resolve four levels above `tests/profile`; moving the fixture requires updating that calculation. Tests use the root Vitest installation and do not install another Harness runtime.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Custom bundles](../README.md) — discovery, profile registration, and shared tools.
- [Upstream compatibility](../OPENAI-UPSTREAM.md) — required generic Harness changes and upgrade checks.
- [Agent API](../../packages/core/agent/README.md) — creation, scoped configuration, and cancellation.
- [HTTP server](../../packages/host/webserver/README.md) — concrete bind addresses and TLS.

-----

<a id="model-experience"></a>
## Model Experience

### Client messages

#### What the model sees

The client supplies `messages`: leading system text, prior user/assistant text, and one current user message. All admitted model-visible text is logged; server prompt sections and tool schemas remain composed by their owners.

#### Token effect

Isolated requests import their supplied history; resumed conversations use their durable server transcript. Enabled tools may require multiple root model calls; configured output and execution limits bound those calls.

#### KV Cache effect

Each request uses a fresh Agent over a new or restored Session. Repeated client history can preserve a textual prefix, while changed client system text, server prompt contributions, or tool allowlists can invalidate reuse; provider caching remains provider-owned.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Text-only Chat Completions; external tool calls, assistant prefill, later system messages, structured output, and other OpenAI endpoints are unsupported.
- SSE delivery is per committed assistant message. Long model calls may produce no response bytes until settlement; deployments must configure proxy idle timeouts accordingly.
- Live execution-resource retention, tenant isolation, approval UI, and asynchronous task recovery are not provided. Tools requiring unavailable interactive approval fail through the composed approval policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

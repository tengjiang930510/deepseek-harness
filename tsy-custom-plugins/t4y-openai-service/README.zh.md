---
description: "通过纯文本 OpenAI Chat Completions 提供 Harness 智能体服务，配置模型别名、工具允许列表、执行限制与 FastGPT。"
kind: "package-bundle"
---

# t4y-openai-service

[English](README.md) | 中文

## 概述

将 FastGPT 等兼容 OpenAI 的客户端连接到 Harness 智能体。每次请求提供文本历史，在启用的工具执行后接收已提交的助手文本。服务端配置公开模型别名、上游路由、工作目录与明确的工具允许列表。请求可恢复持久对话或使用独立 Session，均共享配置的执行环境。

## 目录

- [使用本包](#use-this-package)
- [上传文件交付](#uploaded-file-delivery)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本检出仅在 `openai` profile 注册此 bundle。CLI 通过通用 profile 路径初始化该自定义 profile，不需要官方 OpenAI profile 模板。启动前先构建检出：

```sh
pnpm run build
pnpm dsh openai
```

监听地址默认为 `127.0.0.1:34221`。`DSH_OPENAI_HOST` 和 `DSH_OPENAI_PORT` 覆盖监听地址，`DSH_OPENAI_PROVIDER` 和 `DSH_OPENAI_MODEL` 选择上游路由。公开模型别名默认为 `harness`，单次调用输出上限为 65536 Token，默认启用 `web_search` 和 `web_fetch`。对话模型使用自己的 Harness 凭据。

网页搜索使用 `deepseek-search-api` 和 `DEEPSEEK_SEARCH_API_KEY` 凭据。每台机器在项目根目录的 `.env` 配置该密钥，然后从项目根目录启动。网页解析使用内置 HTTP 提供方。

在 `$DSH_HOME/profiles/openai/cordis.patch.yml`（默认主目录为 `~/.dsh`）设置部署覆盖。修改 `openai-server` 行并明确配置 `models[].tools`。[配置源码](src/config.ts)定义全部限制与校验。本 bundle 不提供应用二进制入口，源码与构建产物均通过 `dsh` 启动。

### HTTP 协议

每次 HTTP 请求默认最多执行 100 次根模型调用（`maxSteps`）。每次请求的累计 Token 预算（`maxTotalTokens`）默认为 10,485,760 个已报告 Token，包括缓存读取与写入。预算在根模型调用之间检查；部署可独立于单次调用的输出上限覆盖该值。

默认两个端点都允许无凭据请求，也接受客户端发送的占位 Bearer token。设置 `apiKeyEnv` 后启用鉴权：启动时及每次请求都通过[凭据服务](../../packages/credentials/credentials/README.zh.md)解析该引用，两个端点此时都要求 `Authorization: Bearer <service-key>`。`GET /v1/models` 返回公开别名。`POST /v1/chat/completions` 接收 `model`、`messages` 与可选的 `stream`；消息支持文本，用户消息也可按顺序包含 `image_url` 图片块。开头的系统消息作为字面量提示词段落与 Harness 指令共同生效。创建新 Session 时，此前的用户与助手消息直接进入日志，不执行操作；最后一条非空用户消息启动 Agent。原生斜杠命令保持为普通文本。响应头 `X-Request-ID` 标识请求诊断；`X-DSH-Session-ID` 标识新建或恢复的 Session。

用户图片支持直接返回图片字节的绝对 HTTP(S) 地址，也支持 FastGPT 上传本地图片时使用的 Base64 数据 URL。附件服务校验 PNG、JPEG、WebP 和 GIF，并保存图片引用供后续会话复用。`maxInputImageBytes` 默认限制每次请求的图片字节合计为 10 MiB，`maxBodyBytes` 默认限制含 Base64 的整个 JSON 请求体为 15 MiB。HTTP 下载每张还受 `imageDownloadTimeoutMs` 限制，默认 15 秒。系统消息与助手历史使用文本。对于描述图片、识别画面和读取可见文字，提示词要求模型直接使用收到的图片。

用户消息可通过 FastGPT 的 `file_url` 内容块传入原件地址 `url` 和可选文件名 `name`。FastGPT 的 HTTP(S) 地址只要路径含有完整的 `/api/common/file/read` 路径段即可下载，主机、端口和部署前缀可不同。其他下载地址可在 `openai-server` profile 中通过 `fileDownloadOrigins` 配置完整来源，或通过 `fileDownloadPathPrefixes` 配置绝对目录地址。下载需要允许的地址直接返回 HTTP 200。下载默认每请求合计 25 MiB（`maxInputFileBytes`），每文件限时 15 秒（`fileDownloadTimeoutMs`）。附件服务保存原始字节，会话保存文件引用供后续轮次使用。路由上启用的文件工具可读取原件，并在会话工作区写入编辑后的副本。下载被拒绝或失败时，本轮在模型运行前结束。

生成参数支持 `temperature`、`stop`，以及 `max_tokens` 或 `max_completion_tokens` 之一。输出 token 限制作用于根智能体的每次对话模型调用，且不能超过路由上限。`n` 仅支持 1；`top_p`、频率惩罚与存在惩罚仅支持中性值。仅支持文本响应格式，不支持外部工具。其他字段与不支持的值返回 400，不会被忽略；`user` 仅作为客户端元数据被接收，不赋予身份或权限。

JSON 与 SSE 通过 `content` 返回最终助手文本，通过 `reasoning_content` 返回公开执行进度，答案消息之间以空行分隔，进度条目之间换行。进度将 `web_search` 显示为“网页搜索”并附上搜索词，将 `web_fetch` 显示为“网页解析”并附上请求的站点和路径。有结果元数据时，完成提示会附上来源数量或 HTTP 状态。地址省略凭据、查询参数和片段。其他工具优先显示公开用途说明 `description`，缺少时显示工具名称。每次调用结束后增加一条紧凑列表记录，包含状态和耗时；失败时附带结构化错误码。只有超过 `progressDelayMs`（默认 1500 毫秒）的调用才增加执行中提示。完成状态表示调用已返回，不表示找到了所需信息。随工具调用一起提交的助手说明也显示在进度中。其他工具参数、原始结果、模型内部推理和失败尝试不对外发送。SSE 帧使用 CRLF 分隔，让旧版 OpenAI SDK 无需等待下一帧即可解析当前帧。SSE 在已提交的说明与工具事件发生时发送进度。任务结束且文件链接确认后，服务通过多条 `delta.content` 帧分段发送正文，短回答只发一帧。`streamContentDelayMs` 默认为帧间等待 35 毫秒，设为 0 时正文一次发完。答案与进度的合计字节数计入 `maxOutputBytes`。成功流以结束原因块与 `[DONE]` 结束；`stream_options.include_usage` 可增加用量帧。用量汇总根智能体已报告的对话调用，包括重试与缓存输入；报告不完整时省略 JSON 用量，或在所请求的 SSE 用量帧中返回 null。

服务提示模型使用用户当前任务的语言填写工具说明，中文任务使用简短的中文短语。

### 对话复用

新 Session ID 统一使用 `openai-` 命名范围，包括独立请求。可选的 [API UI bundle](../t4y-openai-ui/README.zh.md) 将该范围视为 API 管理的会话并以只读方式打开。更早使用 UUID 标识的独立请求 Session 没有持久来源标记，不会被自动分类。

发送 `metadata: {"conversation_id":"your-stable-chat-id"}`，即可将多轮追加到同一个持久 Session。该标识按公开模型别名划分；不同标识或别名对应不同 Session。不提供该字段时，每次请求创建独立 Session。

首次请求导入所提供的文本历史。后续请求恢复服务端日志（包括工具调用和结果），只追加最后一条用户消息，忽略重复传入的客户端历史。同一对话的请求在一个服务进程内按准入顺序执行，排队期间仍受正常的期限与取消约束。每次请求结束后释放 Agent，下一次请求从持久化恢复，服务重启后也可继续。浏览器与终端的存活仍由插件负责。

对话标识不是身份凭据或幂等键。重试会追加一轮；在客户端编辑或删除历史不会改写服务端日志。重置或分支对话时请使用新标识。Session 绑定到不兼容的工作目录或被其他所有者占用时，返回 409；多个进程不共享进程内队列。

### 部署与失败

每个模型路由都要求明确的 `tools` 允许列表和上游 provider/model。空列表不允许执行任何工具。作用域执行守卫也会拒绝列表外的调用。同一路由的请求共享凭据和宿主资源。Session 子目录用于管理文件。互不信任的调用方应使用独立部署或隔离的提供方。

工作区根目录默认为启动目录下的 `.openai-service-workspace/`，可通过绝对路径 `models[].cwd` 覆盖。每个新 Session 按 Harness Session ID 创建子目录，工具相对路径和文件交付均以该目录为基准。后续轮次复用该目录，请求结束后文件保留。已绑定到路由根目录的会话继续使用原路径，默认工作区切换前绑定到启动目录的会话也同样适用。未提供 `conversation_id` 的请求各自使用独立的 Session 子目录。

在仓库根目录使用 Python 3.10 或更高版本运行以下命令。它会创建 `.openai-service-workspace/.python-env/`，并安装 `requirements-python.txt` 中的图片、Office 和 PDF 依赖。路由使用其他工作区根目录时，可传入 `--workspace /absolute/path`。

```sh
pnpm openai:setup-python
```

共享环境存在时，新请求的 Shell 调用会收到 `DSH_OPENAI_PYTHON`。在 Bash 中用 `"$DSH_OPENAI_PYTHON"` 启动，在 PowerShell 中用 `& $env:DSH_OPENAI_PYTHON` 启动。生成的文件保存在当前 Session 目录。使用安装命令维护共享依赖，额外依赖装到该会话自己的虚拟环境。复制项目到其他电脑时，跳过 `.python-env/` 并在目标电脑重建。

Python 提示要求模型优先使用符合任务要求的标准库和共享包，并在使用第三方模块前确认可以导入。服务启动时读取固定版本的 `name==version` 依赖清单，并将其中的包名写入这条提示。

OpenAI 服务在使用共享解释器的 Bash 或 PowerShell 前台调用报告模块缺失后，写入 `.openai-service-workspace/python-missing.md`。调用用 `2>&1` 把异常堆栈重定向到标准输出时，服务先核实共享环境中确实缺少该顶层模块，再计入报表。表格对每个模块按全部已记录的不同会话累计计数。表中的包名供管理员核对，确认后可更新 `requirements-python.txt`。

配置可限制并发、上传字节、输出字节、耗时、根智能体模型步骤、已报告 token 与响应积压。token 预算在根步骤之间检查，可能超出一次调用量；它不包含辅助调用与子智能体调用，也不是计费上限。客户端断开、超时或插件卸载会取消所属 Agent 并等待释放。Session 持久化由组合的提供方决定；每次请求结束后释放执行资源。

凭据无效返回 401，未知别名返回 404，并发或步骤/token 预算耗尽返回 429，请求体过大返回 413，输出超限返回 502，超时返回 504。模型或清理失败返回隐藏内部细节的 5xx 错误，并记录关联请求的服务端诊断。SSE 响应头发出后，失败使用错误帧，不发送成功标记。工具可能已经产生副作用；超时、取消和失败不会回滚这些副作用。不要自动重试有副作用的请求。

### FastGPT

关闭 FastGPT 的“隐藏 AI 思考过程”选项，即可在思考面板显示执行进度。

新增自定义语言模型，使其 ID 与公开别名一致，例如 `harness`。选择 OpenAI 渠道，将 `http://<server>:34221/v1` 配置为 Base URL。若客户端允许，API key 留空；否则在服务端未启用鉴权时填写占位值。启用鉴权后填写配置的服务密钥。若填写完整自定义请求地址，则使用 `http://<server>:34221/v1/chat/completions`。关闭该模型的外部函数调用、多模态输入与结构化响应格式。FastGPT 管理检索、工作流与对话历史；Harness 在每次请求内执行配置的工具。复用 Session 需要客户端转发稳定的对话标识，仅开启历史记录不会提供该标识。不要为所有聊天配置同一个固定标识。代理与客户端超时应匹配部署期限。

-----

<a id="uploaded-file-delivery"></a>
## 上传文件交付

插件 Config schema 默认启用 `openai-server.fileUpload`，即使 profile 用仅含 `models` 的配置替换整个条目，上传仍会启用。它向 `https://jgyw.crfsdi.com.cn:51111/backendapi/file/anonymous-upload` 发送 multipart 字段 `businessKey=zhjl-deepseek-harness` 和 `file`，可用 `DSH_FILE_UPLOAD_URL` 覆盖接口地址。成功响应必须同时满足 HTTP 2xx、数字 `code: 200` 和 HTTP(S) `data.url`。TLS 验证保持开启，上传不会自动重试。

支持图片、PDF、Office 文档、ZIP 及其他单个文件。上传文件使用唯一名称并保留原扩展名，MIME 根据扩展名确定。`src/file-delivery-config.ts` 中经过验证的默认值限制每次回复最多 8 个不同文件、每个文件 20 MiB、每次上传 30 秒、上传响应 64 KiB。可覆盖 `fileUpload: { enabled: false }` 关闭上传；部分上传配置会继承其余经过验证的默认值，显式设置 `enabled: false` 会被保留。接口地址的环境默认值在插件模块加载时读取，修改后需重启。

启用上传后，每个 API Agent 会自动获得作用域内的 `deliver_file` 工具，独立于路由的全局工具白名单。创建文件后使用 `{"path":"report.pdf"}` 调用，工具通过正常持久化的 `tool/result` 记录返回已确认的 `name`、`url`、`size` 和 `mediaType`，模型可以据此在回答中使用真实 URL。关闭上传时不提供交付工具，系统指导要求模型使用此工具，而不是启动本地下载服务器。

可复用的 `FileDelivery` 组件和 `fileDeliveryConfig` 校验器从 `t4y-openai-service/file-delivery` 导出，供 Harness profile 内的插件使用。每个请求创建一个组件，等待 `deliver(path, signal?)`，并通过 `await using` 或 `Symbol.asyncDispose` 关闭，以取消并等待已接收的工作。工具与 Markdown 适配器共享此组件，相同解析路径和字节复用一次上传；字节变化需重新上传；同一请求内不会重试未变化内容的失败上传。不同版本计入同一个文件预算。

最终 Markdown 文件链接、图片目标、引用定义和行内代码路径仍作为兼容措施，调用同一组件。网页链接、代码块、目录和工作目录外的行内代码路径说明保持原样；显式交付工具的路径与 Markdown 文件目标仍须遵守工作目录限制，文件及符号链接目标必须解析到 Session 工作区内。优先使用 `deliver_file` 确认的 URL，图片预览使用 Markdown 图片。纯文本提及的文件无法可靠识别为兼容交付物，目录内容不会自动打包或上传。

上传期间会输出公开进度，全部引用文件确认成功后才发送最终正文。工具失败会记录 `FILE_UPLOAD_FAILED`，不返回已确认 URL；兼容转换失败通过 HTTP 错误返回此代码；此前的文件可能已上传，取消不会删除远端文件。本地原文件始终保留。显式工具交付会将 URL 保存到工具记录；兼容转换在 Session 中保留助手原始本地引用，仅在此次 HTTP 回复中替换为上传后的 URL。返回地址的保留期限和访问权限由外部文件服务负责，客户端浏览器必须能够访问它。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

HTTP 插件负责准入与取消。请求运行器以服务端控制参数创建或恢复 Agent，并观察新的根 Session 事件直到整个 Agent 空闲。已提交的助手结算事件提供输出与用量。成功响应完成前先释放 Agent；卸载时移除路由、取消已接收请求并等待清理。

</details>

### 验证

从仓库根目录运行以下命令。默认测试包含单元测试和无需密钥的 HTTP 会话录制回放；`--live` 额外启用受凭据条件控制的提供方测试。按需运行的浏览器测试需要最新 Web 构建产物及 Chromium。

```sh
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --live
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --ui
```

Profile fixture 使用隔离的 `DSH_HOME`、明确的本地 manifest 依赖及真实 `dsh` CLI。`DSH_EXAMPLE_MODE=src` 选择源码启动；默认 `lib` 模式需要最新检出产物。仓库路径从 `tests/profile` 向上四层解析，移动 fixture 时须同步更新该计算。测试使用根目录 Vitest，不另装 Harness 运行时。

-----

<a id="further-exploration"></a>
## 进一步探索

- [自定义 bundle](../README.zh.md) — 发现、profile 注册与共享工具。
- [上游兼容性](../OPENAI-UPSTREAM.md) — 必需的通用 Harness 修改与升级检查。
- [Agent API](../../packages/core/agent/README.zh.md) — 创建、作用域配置与取消。
- [HTTP 服务](../../packages/host/webserver/README.zh.md) — 具体监听地址与 TLS。

-----

<a id="model-experience"></a>
## 模型体验

### 客户端消息

#### 模型看到的内容

客户端通过 `messages` 提供开头的系统文本、此前的用户/助手文本与一条当前用户消息。所有准入的模型可见文本都进入日志；服务端提示词段落与工具 schema 仍由各自所属模块组合。

#### Token 影响

独立请求导入所提供的历史；复用对话使用服务端的持久记录。启用的工具可能需要多次根模型调用；配置的输出与执行限制约束这些调用。

#### KV Cache 影响

每次请求使用新的 Agent，Session 可以新建或恢复。重复的客户端历史可以保留文本前缀；客户端系统文本、服务端提示词贡献或工具允许列表发生变化时可能破坏复用，缓存机制仍由提供方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 仅支持纯文本 Chat Completions；不支持外部工具调用、助手预填、后续系统消息、结构化输出及其他 OpenAI 端点。
- SSE 按已提交助手消息交付。长模型调用可能在结算前不发送任何响应字节；部署时必须相应配置代理空闲超时。
- 不提供运行中执行资源的保留、租户隔离、审批界面和异步任务恢复。需要交互审批而无可用通道的工具通过组合的审批策略失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

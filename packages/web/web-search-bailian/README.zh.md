---
description: "通过百炼 Responses API 将生成的回答和搜索来源交给 DSH 的 web_search 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-bailian

[English](README.md) | 中文

## 概述

此包通过百炼兼容 OpenAI 的 Responses API 搜索，并将生成的回答和结构化来源 URL 交给 DSH 的 `web_search` 工具。它可以与聊天共用阿里云 API 凭据和模型，包括 `deepseek-v4.1-flash`。每次搜索都会产生一次单独计费的模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-web` 旁加载插件，并将 `web.searchProvider` 设为 `bailian-responses`。`baseURL` 应填写提供所选模型的阿里云工作空间兼容 OpenAI 的 `/v1` 端点。

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

| 字段 | 含义 |
|---|---|
| `apiKeyEnv` | 每次搜索时解析的凭据引用；默认是 `DASHSCOPE_API_KEY` |
| `apiKey` | 可选的明文 API 密钥；非空值优先 |
| `baseURL` | HTTPS 兼容 OpenAI 的 `/v1` 基址；会追加 `/responses` |
| `model` | 执行独立搜索请求的模型 |

提供方发送一个 `web_search` 工具声明并设置 `tool_choice: required`。它从 `message.content[].text` 取得生成的回答，从 `web_search_call.action.sources` 取得去重后的 URL，并将两者交给 `web_search`。响应没有结构化 URL 时会报错。来源只含 URL，工具显示域名标签。Web 服务在提供方返回后应用 `maxResults` 限制。

缺少凭据、取消、无效响应和 HTTP 失败会返回 `WebError`。重定向目标不会被访问。有发起智能体的搜索会在发送前把端点和不含密钥的请求体记录到会话日志。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[`src/index.ts`](src/index.ts) 注册提供方并解析凭据。[`src/provider.ts`](src/provider.ts) 发送 Responses 请求并映射生成的回答和结构化来源 URL。不发布运行时不变量伴随模块，因为此包没有独立的可变状态关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 子系统](../../../docs/subsystems/web.zh.md)定义通用搜索结果和错误字段。
- [Web 包总览](../README.zh.md)列出提供方和消费方。
- [配置目录](../../../docs/config-catalog.zh.md)列出可用设置。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验

### 百炼辅助请求

#### 模型看到的内容

百炼辅助模型会看到带有 `Search the web for:` 前缀的查询。此请求独立于对话模型的上下文。

#### Token 影响

辅助请求会消耗独立的 token，并可能执行多次内部搜索。

#### KV Cache 影响

辅助请求有独立的缓存上下文，与对话请求无关。

### 对话工具结果

#### 模型看到的内容

对话模型通过 DSH 的 `web_search` 工具收到生成的回答和来源 URL。

#### Token 影响

工具结果进入模型请求时，生成的回答和来源 URL 会消耗对话 token。

#### KV Cache 影响

工具结果追加在对话前缀之后，不改变前面的消息。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Responses API 的来源列表只提供 URL，没有标题或摘要。
- `maxResults` 在百炼请求结束后限制 DSH 输出，不能限制内部搜索次数、耗时或服务商费用。
- DSH 的搜索超时可能在百炼返回前终止请求。

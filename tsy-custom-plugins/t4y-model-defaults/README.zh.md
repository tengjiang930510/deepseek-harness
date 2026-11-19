---
description: "武汉地铁 profile 的默认模型和网页搜索设置。"
kind: "package-bundle"
---

# t4y-model-defaults

[English](README.md) | 中文

## 概述

此组合包将 `qwen-token-plan / deepseek-v4.1-flash` 设为默认模型，网页搜索使用 DeepSeek 原生 Search API。源码 Web 启动时会自动发现它。Desktop profile 通过自定义插件同步或整理脚本载入它。凭据与提交到仓库的配置分开保存。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

<a id="use-this-package"></a>
## 使用此包

参考仓库根目录的 `.env.example`，在本地 `.env` 中设置模型调用的 `QWEN_TOKEN_PLAN_API_KEY` 和网页搜索的 `DEEPSEEK_SEARCH_API_KEY`。执行 `pnpm install` 和 `pnpm run build` 后，用 `pnpm dsh web` 启动 Web。

通过 Git 迁移时单独配置凭据。源码 Web 读取启动目录的 `.env`，源码 Desktop 读取仓库根目录的 `.env`，见 [Desktop Host 环境](../../../apps/desktop/README.md#host-environment)。打包后的 Desktop 从启动环境或自身 Harness home 读取同名凭据。打包的试用版本可使用已有的私有 trial-defaults 资源。

接口地址和模型容量保存在 [cordis.patch.yml](cordis.patch.yml)。profile 自己的 patch 优先于此组合包，因此已有的本机选择仍然有效。在插件页禁用此组合包即可停止应用这些默认值。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

组合包配置现有的 `llm-pi-ai`、`agent-default-model`、`web` 和 `web-deepseek-api` 条目，使用凭据引用。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [源码 Web 与 Desktop 插件准备](../README.zh.md)
- [Profile 组合](../../../docs/architecture.md#profiles-and-bundles)

<a id="model-experience"></a>
## 模型体验

配置的默认值为新 Agent 选择模型。现有 `web_search` 工具向 `deepseek-search-api` 发送查询。更换模型或提供方可能改变分词和缓存复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

接口必须可访问，密钥必须有权使用配置的模型。组合包不迁移凭据，也不覆盖已有的 profile patch。

<a id="dev-note"></a>
## 开发笔记

无。

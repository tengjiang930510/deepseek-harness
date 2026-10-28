---
description: "武汉地铁 profile 的默认模型和网页搜索设置。"
kind: "package-bundle"
---

# t4y-model-defaults

[English](README.md) | 中文

## 概述

此组合包将 `qwen-token-plan / deepseek-v4.1-flash` 设为默认模型，并使用同一接口进行百炼网页搜索。源码 Web 启动时会自动发现它。Desktop profile 通过自定义插件同步或整理脚本载入它。凭据与提交到仓库的配置分开保存。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在仓库根目录，将 `.env.example` 复制为被 Git 忽略的 `.env`，填入 `QWEN_TOKEN_PLAN_API_KEY`。执行 `pnpm install` 和 `pnpm run build` 后，用 `pnpm dsh web` 启动 Web。模型调用和百炼搜索都需要此密钥；空值不能完成任一服务的认证。

通过 Git 迁移时单独携带 `.env`，复制私有项目目录时保留该文件。源码 Web 读取启动目录的 `.env`。Desktop 需要在启动环境中设置同名变量，或在自身 Harness home 中保存凭据；只复制仓库 `.env` 不会配置 Desktop。打包的试用版本可使用已有的私有 trial-defaults 资源。

接口地址和模型容量保存在 [cordis.patch.yml](cordis.patch.yml)。profile 自己的 patch 优先于此组合包，因此已有的本机选择仍然有效。在插件页禁用此组合包即可停止应用这些默认值。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

组合包配置现有的 `llm-pi-ai`、`agent-default-model`、`web` 和 `web-search-bailian` 条目，不增加可执行插件，也不内嵌 API Key。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [源码 Web 与 Desktop 插件准备](../README.zh.md)
- [Profile 组合](../../../docs/architecture.md#profiles-and-bundles)

<a id="model-experience"></a>
## 模型体验

配置的默认值为新 Agent 选择模型。组合包不增加提示文本或工具；搜索请求仍通过现有网页工具和百炼提供方执行。更换模型或提供方可能改变分词和缓存复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

接口必须可访问，密钥必须有权使用配置的模型。组合包不迁移凭据，也不覆盖已有的 profile patch。

<a id="dev-note"></a>
## 开发笔记

无。

---
description: "在 Harness 界面中标识 API 管理的 Session，并刷新其只读历史。"
kind: "package-reference"
---

# t4y-openai-ui

[English](README.md) | 中文

## 概述

在会话列表和只读标题栏中显示蓝色 **API** 标记，并在不启动 Agent 的情况下刷新持久消息。本包使用 GUI 的通用只读 Session 状态，不获取写入所有权，也不修改执行服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制](#known-limitations)

<a id="use-this-package"></a>
## 使用本包

在本包目录执行 `pnpm run build` 和 `pnpm test` 可检查构建与行为。JavaScript 入口无需额外的浏览器打包步骤即可加载。React 和共享 UI 原语由提供页面的 Harness 应用提供。

通过 GUI profile 的标准包管理入口安装 bundle，例如从仓库根目录运行 `pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-openai-ui`，然后重启 Web Host 并刷新浏览器。bundle 条目仅在 `web` 和 `desktop` 启用；OpenAI 服务 profile 不加载此 UI。

bundle 为 GUI Session Controller 配置 `readOnlySessionIdPrefixes: ["openai-"]`，阻止其激活 OpenAI 服务命名范围中的 Session Agent。标记同时要求该命名范围和只读状态。安装或移除 bundle 后须重启 Web Host，使所有权策略与 UI 一起加载。

**刷新记录**重新读取当前已保留 Session 的持久历史。加载时按钮禁用；历史不可用时显示本地化失败信息。按钮不发送 prompt、不修改模型，也不会保留列表中的所有 Session。

<a id="understand-the-implementation"></a>
## 理解实现

列表标记使用行的 ID 和只读元数据填充 `sidebar.session.row.badges`。标题栏贡献填充 `conversation.session.header.readonly.actions` 与 `conversation.session.header.readonly.utilities`；后者使用已保留 Session 的公共 `refreshHistory()` 操作。插件拥有字典与私有标记样式，卸载时一并移除。

<a id="known-limitations"></a>
## 已知限制

- 跨进程更新需要显式刷新后显示；本包不添加 Web 与 OpenAI 进程之间的实时事件转发。
- 较早不带 `openai-` 命名范围的独立请求 Session 不由此 UI 分类。

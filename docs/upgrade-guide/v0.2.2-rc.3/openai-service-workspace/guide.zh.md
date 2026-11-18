---
kind: upgrade-guide
description: "自定义 OpenAI 服务将新对话的文件存放在各自的 Session 子目录。"
---

# OpenAI 服务工作区

[English](guide.md) | 中文

## 变更

自定义 `t4y-openai-service` bundle 的默认模型工作区是启动目录下的 `.openai-service-workspace/`。此前直接使用启动目录。显式配置 `models[].cwd` 可指定根目录。新 Session 在 `<根目录>/<session-id>/` 执行工具和交付文件。已绑定路由根目录的会话仍使用原路径，默认工作区切换前绑定到启动目录的会话也同样适用。恢复绑定不兼容目录的 Session 时，服务返回 `409 SESSION_CONFLICT`。

## 迁移

1. 从项目根目录运行 `pnpm dsh openai`，使用该项目下的 `.openai-service-workspace/`。如果 profile 已显式配置 `cwd`，请在 `$DSH_HOME/profiles/openai/cordis.patch.yml` 中将该模型的 `cwd` 改为新工作区的绝对路径，再重启 OpenAI 服务。
2. 新建客户端对话，让模型使用相对路径创建一个文件。确认文件出现在 `.openai-service-workspace/<session-id>/`。继续同一个对话可使用该目录下的文件。

---
description: "升级自定义 OpenAI 服务和 API 历史 UI 时检查必需的 Harness 扩展点。"
---

# OpenAI 插件上游兼容性

[English](OPENAI-UPSTREAM.md) | 中文

## 摘要

自定义[服务](t4y-openai-service/README.zh.md)与 [API 历史 UI](t4y-openai-ui/README.zh.md)依赖少量通用 Harness 扩展。[审查基线](upstream-baseline.json)记录评估这些扩展时的检出版本与提交。它用于升级审查，不是运行时版本锁，也不承诺未经修改的上游版本兼容。

## 必需的 Harness 支持

| 范围 | 必需行为 | 升级审查 |
|---|---|---|
| `AgentOptions.configureCall` | 每个 Agent 的请求控制参数在分发前进入已准备请求及持久请求头。 | 保留 `temperature` 与 `stop` 日志、请求隔离、重试计量及已准备调用校验。不要在 `llm/stream` 修改控制参数，也不要为已弃用的 `agent/request` 新增监听。 |
| JSONL `checkpointLive` | flush 与 close 竞争时等待该 close，并报告其失败。 | 保留 drain 顺序及失败传播。回归测试保留在 JSONL 提供方；自定义插件无法安全替换其私有 writer 生命周期。 |
| Session 只读访问 | 配置的前缀选择历史只读访问；读取与刷新不激活 Agent，也不取得其写锁。服务端拒绝修改只读 Session。 | 联合检查 `readOnlySessionIdPrefixes`、传输字段 `readOnly`、保留历史刷新、RPC 保护及未激活 Session 加载。 |
| 通用客户端 slot | 会话行徽标及只读页头操作、工具区接受插件贡献。 | 保留 slot 声明、语言归属、资源释放，以及对输入、反馈、分支和修改控件的抑制。API 文案与蓝色样式保留在自定义 UI bundle。 |

这些修改是通用上游审查项。自定义 bundle 管理 HTTP 路由、OpenAI 校验、SSE CRLF 帧、公开进度、模型预算、会话标识、API 前缀、标签及 profile 注册。不要删除 `session.lock`：API 执行持有写入权，UI 读取持久历史。

## 升级检查清单

1. 对比候选上游检出与链接的基线，逐项审查上述必需行为。仅保留或重放上游尚未提供的支持。
2. 保留持久 `openai-` Session ID，以及公开模型别名加会话标识的映射。移动包文件不能产生第二套会话命名范围。`readOnly` 是临时远程元数据，不是新的持久 Session 头字段。
3. 构建候选检出，然后运行下列定向命令。修改 CLI 或包解析时，再以源码启动运行录制回放。
4. 验证 Web 打开历史时 API 仍可执行，并验证刷新能显示新增持久轮次。只读分类不提供用户鉴权或租户隔离。

```sh
git rev-parse HEAD
pnpm run build
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs
DSH_EXAMPLE_MODE=src node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs -t "resumes one conversation over HTTP"
node tsy-custom-plugins/t4y-openai-service/scripts/test.mjs --ui
node --test tsy-custom-plugins/t4y-openai-ui/tests/client.test.mjs
pnpm exec vitest run packages/core/agent-loop/tests/call-controls.spec.ts packages/session/session-persistence-jsonl/tests/jsonl.spec.ts
```

浏览器命令需要最新 Web 产物及 Chromium。真实提供方验证单独运行：有凭据时在服务 runner 添加 `--live`。此处检查均无需重启用户服务或访问真实 DSH 主目录。

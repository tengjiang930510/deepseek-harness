# t4y-identity

[English](README.md) | 中文

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-identity)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

对接既有后端登录：`publicKey → RSA(PKCS1) 加密密码 → login → Authorization → getInfo / getRouters`。未登录时全屏门禁，登录后账号菜单展示 `user.nickName`。

## 领域 id

| 概念 | 来源 | 含义 |
|---|---|---|
| `tenantId` | 登录 `enterprise.id` | **整个系统**的 id；暂时只会有这一个 |
| `moduleId` | `getRouters` 里选中的 module | **企业** id（分账 / 工作区 / 授权菜单） |
| Hub `projectName` | 企业菜单表单字段 | 插件坐标，与上两者不是同一套 id |

上游登录 body 仍用字段名 `enterpriseName`（既有后端约定）；落入会话后系统 id 记为 `tenantId`。

## 登录链路

| 步骤 | 接口 | 说明 |
|---|---|---|
| 公钥 | `GET /auth/publicKey` | 取 `data.publicKey`（SPKI Base64） |
| 登录 | `POST /auth/login` | body：`enterpriseName` / `userName` / RSA 加密后的 `password` |
| Token | 响应 `data.access_token`、`data.expires_in` | `expires_in` 为单位**分钟**（如 `43200` = 30 天）；客户端换算成秒再交给 Key Broker。后续请求头：`Authorization: <access_token>`（无 Bearer 前缀） |
| 用户信息 | `GET /system/user/getInfo` | `user.nickName`；`enterprise.id` → 会话 `tenantId` |
| 企业列表 | `POST /system/module/getRouters?clientType=0`（空 body） | 账号已分配企业；无企业时停留在门禁并提示联系管理员 |

## UI

| 参照 | 用途 |
|---|---|
| 全屏门禁 | 未登录 / 恢复会话中不展示其它页面 |
| 企业选择 | 多个 `moduleId` 时登录后强制选择；「更多」菜单提供切换 |
| 宿主账号菜单适配器 | 未登录「账户登录」；已登录「切换」+「退出登录」；确认框展示 nickName |
| `shell.overlay` | 登录 / 企业选择 / 退出确认 |

登录恢复和切换企业时保留当前工作区及会话；插件菜单和授权按当前企业重新查询。会话历史不会按企业隔离，切换企业后继续对话时，已有上下文仍会保留。

## 配置（cordis.patch）

| 字段 | 说明 |
|---|---|
| `apiBaseUrl` | 默认 `https://jgyw.crfsdi.com.cn:51111/backendapi` |
| `brokerBaseUrl` | 必填。DSH Host 进程访问的 Key Broker 地址 |
| `newApiBaseUrl` | 必填。New API 的 OpenAI 兼容 `/v1` 地址 |

### 模型 Key（强制 New API）

登录 access token **不能**直接打模型。推理 Key 按人一把；分账挂在首次签发的企业（`homeModuleId` / `keyHomeModuleId`）。

| 角色 | 企业（moduleId） | 模型 Key | New API 分账 |
|---|---|---|---|
| 普通用户 | 只有 1 个 | 登录/首次选定签发 | 自然落在该企业 |
| 管理员 | 可切换多个 | **同一把**；切企业不重签 | 记在首次签发的企业；要改归属则退出再登录并选目标企业 |

写入本机槽 **`T4Y_NEW_API_KEY`**。当前 `moduleId` 驱动工作区 / 品牌 / 授权菜单。浏览器不持有模型 Key。

| 本机接口 | 作用 |
|---|---|
| `POST /api/t4y-identity/issue-model-key` | 登录/恢复/首次选企业：Broker 签发或复用 Key → 写槽 → 同步 `/models` |
| `POST /api/t4y-identity/session-status` | 每分钟 / 回前台：本机槽 + Broker 用户账本 |
| `POST /api/t4y-identity/revoke-model-key` | 退出：Broker 删 Token + 清本机槽 |
| `POST /api/t4y-identity/set-context` | 切企业：写 Host `t4yTenant`（`tenantId` + `moduleId`；不换 Key） |
| `POST /api/t4y-identity/project-workspace` | 工作区相关接口；项目切换时保留当前工作区和已有会话 |

**过期 / 换 Key（不做静默续期）：**

| 情况 | 行为 |
|---|---|
| 同一用户再 issue（未过期） | 同一把 Key 与原始 `expiresAt`，不续期 |
| 模型 Key 已过期后再登录 issue | Broker 写入新的 `expiresAt`（有旧 Key 材料则不重新 reveal） |
| 切换企业（含管理员） | **不**重签 Key；更新品牌和授权插件，保留当前工作区及会话；分账仍在 `keyHomeModuleId` |
| 管理员改分账企业 | 退出（revoke）→ 再登录 → 选目标企业签发 |
| 登录后首次选企业（尚无 Key） | 签发一次，`keyHomeModuleId` = 该企业 |
| Token 或模型 Key 到期 / status `active: false` | 回登录门禁 |
| 聊天 `AUTH` 401 | 清本机槽 → 回登录 |
| 退出登录 | revoke + 清槽 |

**不要**在 CLI `--patch` overlay 里写入 `llm-pi-ai` / `agent-default-model`：命令行 overlay 会锁住 `settings.update`。企业模型路由由本插件在可写 settings 层 seed，签发后再覆盖 `models`；默认模型优先 `qwen3.8-flash`。

当前部署约定可选模型为 `qwen3.8-flash` / `qwen3.8-max`；联网搜索固定使用代理后的 `qwen3.8-flash`（`t4y-trial-runtime`）。

## 客户端约定

- 会话键：`localStorage['t4y.identity.session.v1']`（含 access token、`tenantId`、`moduleId`、`llmApiKeyExpiresAt`；**不含**模型 Key 明文）
- 偏好键：`localStorage['t4y.identity.prefs.v1']`（退出后仍保留：登录企业名、账号、上次 `moduleId`）
- 事件：`t4y-identity:session`、`t4y-tenant:changed`、`t4y-brand:changed`
- 桥：`window.__t4yIdentity`（`getSession` / `getAccessToken` / `getModuleId` / `selectModule` / `logout`）
- 退出先 revoke 模型 Key；到期 / status 失效 / 聊天 AUTH 清槽后回门禁
- 再次登录时若上次企业仍在列表中，跳过选择，直接进入

## 联调

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

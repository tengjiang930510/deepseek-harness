# t4y-key-broker

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。源码在本仓库 `tsy-custom-plugins/t4y-key-broker/`；当前评测部署在 `192.10.51.138:4010`。

登录后的 **New API 推理 Key** 签发服务。总账户登录仍由 `t4y-identity` 完成；Broker 用 access token 调 `getInfo` 校验身份。

## 产品模型（与 identity 对齐）

| 概念 | 含义 |
|---|---|
| `tenantId` | **整个系统**的 id（登录 `enterprise.id`）；暂时只会有这一个 |
| `moduleId` | **企业** id（分账 / 工作区）；普通人一个，管理员可切换多个 |
| 模型 Key | 按企业用户 `userId` 一人一把 |
| `homeModuleId` | 首次签发时的 `moduleId`（企业）→ New API `mod_<hash>` 户 |

### 管理员怎么用

1. 登录后选**当前要干活的企业**（`moduleId`）→ 首次签发，Key 与 New API 用量挂在该企业下。
2. 再切到其它企业 → 只换工作区/菜单，**同一把 Key**，分账仍记在步骤 1 的 home。
3. 若要把费用改记到另一企业：在客户端**退出登录**（revoke），再登录并选目标企业重新签发。

## 行为

- 首次签发：确保该企业 `moduleId` 有 New API User，创建 `usr_<userHash>` Token；账本一行/用户，`module_id` = home 企业。
- 同一用户再 issue（未过期）：返回同一把 Key 与原始到期时间，**不续期、不重新 reveal**；响应带 `homeModuleId`。
- Token 到期来自 `expiresIn`（**秒**，最大 30 天）。未过期不静默续期；**过期后**重新登录再 issue：写入新的 `expiresAt`，账本仍有 Key 材料时不重新 reveal。

## 规模与并发（万级用户）

SQLite WAL（`BROKER_SQLITE_PATH`，默认 `broker.db`）；启动幂等 upsert 旧 `state.json`。

| 路径 | 行为 |
|---|---|
| 重复 issue / status | 按用户 O(1)；`getInfo` 缓存默认 45s |
| 首次签发 | 仅对该用户串行 |
| 管理台 | 按 Key 的 home `moduleId`（企业）归组 |

多机前换共享库；瓶颈通常在 New API 管理面与企业 `getInfo`。

## 运行

复制 `.env.example` → 受限权限环境文件；跑 `server.py`（`server.mjs` 为旧原型，勿用于规模部署）。

**管理面：** `sk-` 不能调管理 API；Broker 缓存 root JWT，用 `New-Api-User` 代管。

```http
POST /v1/session/issue
Authorization: <企业 accessToken>
Content-Type: application/json

{"expiresIn": 2592000, "moduleId": "<enterprise-module-id>", "moduleName": "武汉地铁"}
```

返回 `apiKey`、`expiresAt`、`homeModuleId`、`userId`、`tenantId`。Key 缓存在 SQLite；管理台 overview **不**返回完整 `sk-`。

- `POST /v1/session/status`：按用户查账本（`moduleId` 可选，兼容旧客户端）。
- `POST /v1/session/revoke`：删除该用户唯一 Key（`moduleId` 忽略）。

## 管理台

按 **home 企业（module）** 列出成员 Key，可吊销单用户或整企业 home 下的会话。

1. 设 `BROKER_ADMIN_TOKEN`；打开 `http://<host>:<port>/admin`。
2. API：`GET /v1/admin/overview`、`POST /v1/admin/session/revoke`、`POST /v1/admin/project/revoke-sessions`。

Docker 建议 `--network host`。公网须 HTTPS + 来源限制。

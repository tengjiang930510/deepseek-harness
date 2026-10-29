# t4y-key-broker

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。源码在本仓库 `tsy-custom-plugins/t4y-key-broker/`；当前评测部署在 `192.10.51.138:4010`。

登录后的 **New API 推理 Key** 签发服务。总账户登录仍由 `t4y-identity` 完成；Broker 用 access token 调 `getInfo` 校验身份，再按产品 **项目 `moduleId`**（如武汉地铁、襄阳铁路公安）映射为 New API User，并在该 User 下签发 Token。总账户（tenant）只作上级，不单独开 New API 户。DSH 把返回的 Key 存进本机凭据槽 `T4Y_NEW_API_KEY`。

## 行为

- 首次进入某项目：为该 `moduleId` 创建 New API User（`mod_<hash>`），额度设为 `BROKER_ENTERPRISE_QUOTA`。
- 该项目下成员首次签发：创建对应 User 下的 `unlimited_quota` Token。
- 同一未过期 access token + 同一 `moduleId` 重复签发：返回同一把 Key 和原始到期时间，**不会续期**。
- 切换项目会带新的 `moduleId` 再签发（可能换一把 Key）。
- Token 到期时间来自首次签发时的 `expiresIn`，最大不超过 30 天。
- access token / Broker 会话已过期后再 issue：拒绝；客户端须重新登录后再签发（identity **不**静默续期）。

## 运行

复制 `.env.example` 到受限权限的环境文件，填入 New API 根管理员凭据，然后运行 Python 实现（`server.py`）或 Node 原型（`server.mjs`）。

**管理面凭证：** New API 的 `sk-` 推理 Key **不能**调用管理 API。Broker 只缓存一份 root 登录 JWT（写入 `management_sessions`），用 `New-Api-User: <企业用户 id>` 代管各企业下的成员 Token。热路径（签发/撤销）不再对企业账号做 password login。

**session-status：** 只读 Broker 本地 state（已签发 / 未过期 / 未撤销），不访问 New API。远端 Key 被手工删除时，以聊天 401 清本地凭据并回登录页为准。

Docker 部署时优先 `--network host`，`NEW_API_BASE_URL` 建议用宿主机局域网地址。服务默认监听 `BROKER_LISTEN_HOST` / `BROKER_LISTEN_PORT`（示例 `4010`）。公网暴露前须加 HTTPS 与来源限制。

内网直连试运行会允许任意浏览器 Origin。它不能用于公网环境；正式部署应收紧来源并置于 HTTPS 后。

客户端在既有登录成功后调用：

```http
POST /v1/session/issue
Authorization: <既有系统 accessToken>
Content-Type: application/json

{"expiresIn": 2592000, "moduleId": "<project-module-id>", "moduleName": "武汉地铁"}
```

Broker 返回 New API Key 和过期毫秒时间戳。完整 Key 只在签发响应中返回，Broker 状态文件不保存它。

`POST /v1/session/status` 须带同一 `moduleId`，只查 Broker 本地账本；`active: false` 时回登录页。`POST /v1/session/revoke` 可带 `moduleId` 删当前项目 Key，省略则删除该 access token 下全部项目 Key（退出登录）。

## 管理台

按**项目**查看签发情况（项目名、`moduleId`、成员 nickName、所属企业、到期），并吊销单个或整项目会话。New API 后台本身看不到这些产品字段。

1. 设置环境变量 `BROKER_ADMIN_TOKEN`（长随机串）；未设置则 `/admin` 返回 503。
2. 浏览器打开 `http://<broker-host>:<port>/admin`，粘贴该 Token。
3. API：`GET /v1/admin/overview`、`POST /v1/admin/session/revoke`、`POST /v1/admin/project/revoke-sessions`，均需 `Authorization: Bearer <BROKER_ADMIN_TOKEN>`。

管理台不返回完整 `sk-` Key；签发时写入的 nickName / 企业名供列表展示。

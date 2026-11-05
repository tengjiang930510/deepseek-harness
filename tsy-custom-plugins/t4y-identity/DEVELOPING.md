# t4y-identity 开发指南

产品行为与接口表见 [README.md](./README.md)。

## 职责

企业 RSA 登录门禁、nickName / 企业选择。`tenantId` = 系统 id（登录 `enterprise.id`，暂单例）；`moduleId` = 企业 id（普通人一个，管理员可多选）。Key 按用户一把（`keyHomeModuleId` = 分账企业）；切企业不换 Key。管理员改分账归属：退出后再选目标企业签发。

## 依赖

- **依赖：** Host 配置 `brokerBaseUrl`、`newApiBaseUrl`；Client inject `t4y-capability-hub`（同 ctx 启动授权页）。
- **建议同装：** `t4y-tenant`、`t4y-brand`、`t4y-trial-runtime`。
- **外部：** 企业后端、Key Broker（`t4y-key-broker`）、New API。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` | Host：调 Broker 签发 / 撤销 / session-status；把 New API Key 写入凭据槽并同步模型 settings |
| `client.js` | 登录 UI、会话、`window.__t4yIdentity`、周期校验 |
| `cordis.patch.yml` | 关闭官方「模型」设置页等企业策略 |

## 本地开发

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
pnpm dsh web
```

Broker / New API 地址写在 profile 或 patch 的 identity `config` 里，**不要**用 CLI `--patch` 去锁 `llm-pi-ai` / `agent-default-model`（会阻断登录后写模型列表）。

会话调试：`localStorage['t4y.identity.session.v1']`；偏好：`t4y.identity.prefs.v1`；跨端共享：`~/.dsh/t4y-identity/host-session.json`（`GET/PUT/DELETE /api/t4y-identity/host-session`）。

## 验证

- 错误密码 → 门禁错误文案，不进入主界面。
- 登录成功 → 侧栏品牌与 nickName；凭据槽 `T4Y_NEW_API_KEY` 已写入 New API Key；可发一条模型请求。
- 切换企业 → 品牌 / Host tenant / 授权菜单更新；模型 Key 不变；当前工作区和会话保留；上一企业未授权包后台 disable（不挡切换）。
- Desktop：登录后窗口应原地放大（同窗 `setSize`）；偶发重载不应再闪「正在恢复登录…」。
- 退出 → Broker revoke + 清本机槽；回门禁；企业名/账号偏好仍在。
- 企业 Token / 模型 Key 过期、status `active: false`、或聊天 `AUTH` 401 → **回登录门禁**（不静默续期）。
- 同一未过期企业 Token 冷启动再 issue → 同一把 Key、不续期。

## 发布注意

- Desktop trial 必选包；改 `client.js` / `index.js` 后重新 `stage-desktop-trial-plugins` 再打包。
- 打包后依赖应落在用户 profile 的 `.dsh-trial-plugins/`，勿依赖安装盘绝对路径。

## 常见坑

- Client 依赖 capability-hub：hub 的 client 脚本加载失败会导致 identity 一并 web-boot 失败（Desktop fatal）。
- 浏览器拿不到模型 Key；联调 Broker 必须在 Host 进程可达的地址（常用内网 `http://`）。
- `Authorization` 头无 `Bearer` 前缀，与企业后端约定一致。
- `T4Y_NEW_API_KEY` 只是凭据**引用名**；不要理解成本机生成的备用 Key。
- 切换企业不会切换或归档会话；会话上下文不会按企业隔离。
- 切企业会后台 disable 新菜单未授权的已管理包（不卸载），避免拖慢切换。

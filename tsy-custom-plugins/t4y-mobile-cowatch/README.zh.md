# t4y-mobile-cowatch

手机同看策略插件：**手机只遥控电脑上的 DSH**，不单独做企业登录，不调用内网 Broker / 大模型。

## 身份与 accessToken（已定口径）

采用「遥控电脑会话」模型，**不要**改成手机全程持有真企业 token 调业务接口。

| 位置 | 值 | 用途 |
|------|-----|------|
| 电脑 `host-session` | 真企业 accessToken | 电脑侧企业 API、模型 Key |
| 手机身份会话 | 占位 `mobile-cowatch` | 跳过登录门、展示已登录 |
| 手机 `switchAuth` | 真企业 accessToken（若有） | 仅 sessionStorage；入口登录 / `switch-auth-seed` / handoff redeem |
| 配对 Cookie | 设备凭证 | 经 FRP 访问本机网关；杀进程后可再拉 seed |

`GET /api/t4y-identity/host-session` 对手机只返回占位会话；真 token 留在电脑磁盘，由 Host 代理切换项目 / 扫码 seed。
跨电脑切换用一次性 `handoff` 码（约 2 分钟），**禁止**把 accessToken 放进 URL hash。

进主界面依赖：配对成功 + 种子会话 + `entered` 标记。模型与企业调用仍在电脑 Host 执行。

## 行为

| 端 | 行为 |
|----|------|
| 电脑（桌面） | 账号菜单「移动访问」软开关 + 扫码出码；FRP 保活；软关踢设备但不拆隧道 |
| 手机（进入会话 / 移动 UA） | WaitGate、闲置断 WS、切换电脑/项目；不签发/撤销电脑模型 Key |

交付目标以**当前正在登录的电脑**为准；本机历史 origin 记忆非交付项。公网 `/t4y-mobile-enter` 登录选机与扫码免登两条入口并存；软关时隐藏扫码。

手机侧还保留：设置 Tab 横滑、菜单快捷键隐藏、闲置 15 分钟断实时 WebSocket（配对 Cookie 保留，点「继续使用」免登续连）。

## 依赖

需同时加载 `t4y-identity`（提供 `host-session`）。联调 overlay 见 `tenant-identity.overlay.yml`。

Client 源码在 `client-src/`（按端拆分）；改完后先 `node scripts/bundle-client.mjs` 生成 `client.js`，再执行：
`pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-mobile-cowatch`，然后重启 Web。

**打包注意：** `index.js` 本地 `import` 的 sibling（如 `per-host-origin.js`、`handoff.js`）必须列入 `package.json` 的 `files` 并提交。本机 `link:` 能看见未跟踪文件，stage 安装包不会；漏列会导致 Desktop 加载本包直接失败。新增 `client-src` 分片后要改 `scripts/bundle-client.mjs` 的 `PART_FILES`、重新 bundle，并把分片源文件一并提交。

## 接口

| 路由 | 说明 |
|------|------|
| `GET /api/t4y-mobile-cowatch/credential-status` | Host 是否已有 `T4Y_NEW_API_KEY` |
| `POST /api/t4y-mobile-cowatch/bind-device-label` | 将当前/最近 dsh-mobile 设备名改为企业 `displayName` |
| `POST /api/t4y-mobile-cowatch/presence` | 手机页心跳 / 关页离线；需配对 cookie |
| `GET /api/t4y-mobile-cowatch/connected-devices` | 当前有新鲜心跳的手机（不含历史配对行） |
| `POST /api/t4y-mobile-cowatch/per-host-origin` | 将 FRP `publicOrigin` 改写为本机子域名 |

软关闭约 60 秒后释放 FRP。多机 Caddy：`../ops/frp-multi-host-caddy.md`。
| `GET/POST /api/t4y-mobile-cowatch/accepting` | 软开/软关（关时 revoke 已配对设备） |
| `GET /api/t4y-mobile-cowatch/switch-auth-seed` | 扫码后 / 配对态回填 session-only `switchAuth` |
| `POST /api/t4y-mobile-cowatch/handoff-mint` | 目标电脑签发一次性切换码（CORS，无 Cookie） |
| `POST /api/t4y-mobile-cowatch/handoff-redeem` | 兑换 handoff 码为 `switchAuth`（一次性） |
| `POST /api/t4y-mobile-cowatch/switch-module` | 手机切项目：Host 用磁盘真 token 改电脑会话 |

本地回归：`node --test tsy-custom-plugins/t4y-mobile-cowatch/handoff.test.js tsy-custom-plugins/t4y-mobile-cowatch/regression.test.js`

扫码页 `/mobile-access/pair`：自动配对并种子会话，免企业登录直进本机。

## 手机 WaitGate 阶段

| `data-phase` | 含义 |
|--------------|------|
| `checking` | 正在确认电脑登录 |
| `waiting_login` | 请在电脑登录并选项目 |
| `waiting_key` | 电脑尚无模型凭据 |
| `entering` | 已就绪，进入助手 |

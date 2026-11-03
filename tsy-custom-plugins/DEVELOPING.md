# tsy-custom-plugins 开发指南

本目录是武汉地铁（及同类企业）DeepSeek Harness **树外定制插件与打包素材**，不属于 `packages/*/*` 工作区。产品行为说明见各包 `README.md`；本文只讲**怎么改、怎么验、怎么打进安装包**。

## 读者起点

- 已能在本仓库根目录执行 `pnpm install`、`pnpm dsh web`。
- 需要改登录、品牌、授权插件、发布安装，或打 Desktop 试用包。

## 包一览与依赖

| 包 | 角色 | 典型依赖 |
|---|---|---|
| `t4y-tenant` | 当前企业 / 项目上下文 | 无（被 identity 驱动） |
| `t4y-identity` | 企业登录门禁 + 模型 Key 桥 | tenant、brand；client 注入 capability-hub |
| `t4y-brand` | 侧栏 / 首屏品牌 | identity 会话事件 |
| `t4y-capability-hub` | 设置页「授权插件」 | release-manager、identity Token |
| `t4y-release-manager` | 按授权 + `latest.json` 安装不可变版本 | Host `pluginManager` |
| `t4y-trial-runtime` | 试用内置模型 / 联网搜索默认 | Desktop 试用包 |
| `oa-helper` | 办公表单能力（包名 = 菜单 name） | 经授权页安装，不进默认 trial seed |
| `t4y-key-broker` | 独立 Key Broker 服务（非 DSH 插件） | New API 管理面 |
| `hub-projects/` | Hub catalog / latest 本地样板 | 发布到 Gitee Hub |

推荐加载顺序（Web / Desktop sync 脚本一致）：tenant → identity → capability-hub → brand → release-manager → trial-runtime。

## 日常开发循环（Web）

1. 改 `tsy-custom-plugins/<pkg>/` 下源码（`index.js` Host，`client.js` Client）。
2. 安装或刷新到 web profile（路径用相对仓库根，勿写死本机绝对路径进仓库文件）：

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-release-manager
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-trial-runtime
```

3. 启动：`pnpm dsh web`（已在跑则重启，或依赖 HMR 视改动面而定）。
4. Host 半截可单独：`pnpm dsh web --patch ./tsy-custom-plugins/tenant-identity.overlay.yml`；Client 仍以 profile 已装包为准。

换机器或移动仓库后，重新执行上面的 `plugin add`，让 profile 的 `link:` 指向新路径。

## Desktop 开发循环

1. 退出 Desktop。
2. `node ./tsy-custom-plugins/scripts/sync-desktop-plugins.mjs`（同步到 `~/.dsh/profiles/desktop` 等）。
3. 再开 Desktop（`pnpm start:desktop` / 已安装的 App）。

### UI 约束：禁止出现在「已安装插件」

左上角 **插件 → 已安装插件** 只给用户自行安装的第三方包。`t4y-*`（及旧包 `@deepseek-ai/dsh-t4y-enterprise`）是部署/试用 seed，**不得**出现在该分组；Hub 能力走 **设置 → 授权插件**。Client 侧由 `isDeploymentOwnedEnterprisePlugin` 过滤；profile 的 `bundles` 勿残留无对应 `dependencies` 的包名。

## 打试用安装包（Mac unsigned）

无符号 mac 打包**不会**读 `.env.macos` 里的 trial 路径，必须在进程环境里给出**绝对路径**：

```sh
node ./tsy-custom-plugins/scripts/stage-desktop-trial-plugins.mjs
node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs   # 若需内置试用 Key

export DSH_DESKTOP_TRIAL_PLUGINS_DIR="$PWD/apps/desktop/.desktop-build/trial-plugins"
export DSH_DESKTOP_TRIAL_DEFAULTS_FILE="$PWD/apps/desktop/.desktop-build/t4y-trial-defaults.json"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # 按需

# 需 Node ^22.19 或 >=24（import.meta.main + native headers）
node --import tsx/esm scripts/build.ts --profile official
pnpm run package:desktop:mac:arm64:unsigned
```

产物：`apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/*.dmg`。

正式给用户用：把 `.app` 装进 `/Applications`（或 Windows 安装器），不要长期从 DMG / 临时目录直接跑。插件依赖会 seed 到用户 profile 的 `.dsh-trial-plugins/`，不绑安装盘路径。

Windows unsigned：`pnpm run package:desktop:win:x64:unsigned`（先填 `apps/desktop/.env.windows`）。

## Hub / 授权插件发布

1. 在 Gitee Hub 按 `{projectName}/plugins/{name}/` 放不可变版本与 `latest.json`。
2. 企业后台菜单叶子表单字段标题为 `name`、`projectName`。
3. 客户端「授权插件」只装 `latest.json` 指向的当前版；`releases` / 历史 commit **只增不改**。

本地对照：`hub-projects/`（见其开发指南）。

## 配置与密钥

- 仓库内 `cordis.yml` / overlay **禁止**提交本机绝对路径。
- `brokerBaseUrl` / `newApiBaseUrl` 配在 identity 的 cordis 配置；浏览器不持有模型 Key。
- 推理 Key **必须**经 Broker 由 New API 按**本次登录**签发；本机 `T4Y_NEW_API_KEY` 只是凭据槽位，切项目不换 Key，过期/失效后回登录再签发，不静默续期（见 [t4y-identity README](./t4y-identity/README.md)）。
- 试用 Key 仅进 gitignore 的 `.desktop-build` 与受限 env，勿提交。

## 各包开发指南

| 包 | 指南 |
|---|---|
| 项目总览 | 本文 |
| [t4y-tenant](./t4y-tenant/DEVELOPING.md) | |
| [t4y-identity](./t4y-identity/DEVELOPING.md) | |
| [t4y-brand](./t4y-brand/DEVELOPING.md) | |
| [t4y-capability-hub](./t4y-capability-hub/DEVELOPING.md) | |
| [t4y-release-manager](./t4y-release-manager/DEVELOPING.md) | |
| [t4y-trial-runtime](./t4y-trial-runtime/DEVELOPING.md) | |
| [oa-helper](./oa-helper/DEVELOPING.md) | |
| [t4y-key-broker](./t4y-key-broker/DEVELOPING.md) | |
| [hub-projects](./hub-projects/DEVELOPING.md) | |

产品契约与接口表仍以各包 `README.md` 为准。

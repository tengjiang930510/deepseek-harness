# tsy-custom-plugins 开发指南

本目录是武汉地铁（及同类企业）DeepSeek Harness **树外定制插件与打包素材**，不属于 `packages/*/*` 工作区。产品行为说明见各包 `README.md`；本文只讲**怎么改、怎么验、怎么打进安装包**。

各插件的调用逻辑、状态、边界及失败情形见 [企业插件实现与边界](./PLUGIN-REFERENCE.md)。

## 开发规范

1. 新增企业或业务行为时，先确定负责的插件和依赖服务；优先在 `tsy-custom-plugins/` 中使用 DSH 的 Cordis 服务、事件、命令、工具、配置补丁和客户端槽位，不直接修改 DSH 原生代码。
2. 配置、业务权限、模型凭据、展示资料各有独立来源。插件界面只能展示当前服务端授权结果；缓存不替代授权，账号或项目变化时不能沿用旧授权。
3. 每项插件行为写明入口、输入输出、可见副作用、存储位置、权限来源、异常处理、卸载清理和能力限制；在 [插件参考](./PLUGIN-REFERENCE.md) 更新责任边界，在所属包说明维护配置及具体契约。
4. 注册监听器、UI 插槽和对其他服务的适配时管理生命周期，插件卸载后撤销自身效果；异步操作应防止已切换账号或项目的旧响应覆盖当前状态。
5. 无现成扩展点时，先记录需求、宿主限制、插件和部署方案，并评估升级与回滚；只有用户明确授权后才可修改 DSH 原生代码。当前桌面窗口、安装种子、打包和子进程仍有原生改动，详见插件参考，不能将现状描述为完全插件化。
6. 修改前确认现有行为和影响面；修改后运行所属自动化测试、相关构建检查，并在 Web 实际验证登录、权限或 UI 变化。影响桌面版时还要验证桌面应用和实际安装包；未运行、跳过或失败的检查单独报告。
7. 测试使用隔离账号、配置和数据。请假等真实提交、权限更改及其他业务副作用必须有明确授权；无授权时只验证到提交前。绝不把密码、access token、模型 Key、本地密钥配置或真实用户截图提交到仓库。
8. 发布前检查用户、项目、授权、缓存与失败恢复；版本或种子更新要验证新安装和已有安装的升级路径。推送前遵循仓库的检查规则，不把未签名测试包当作正式发布包。

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
| `t4y-mobile-cowatch` | 手机同看 WaitGate + 设备名绑企业用户 | 需同 profile 装 `dsh-mobile` |
| `oa-helper` | 办公表单能力（包名 = 菜单 name） | 经授权页安装，不进默认 trial seed |
| `t4y-key-broker` | 独立 Key Broker 服务（非 DSH 插件） | New API 管理面 |
| `hub-projects/` | Hub catalog / latest 本地样板 | 发布到 Gitee Hub |

推荐加载顺序（Web / Desktop sync、试用 stage 一致）：`dsh-mobile@0.8.2` → tenant → identity → capability-hub → brand → release-manager → trial-runtime → mobile-cowatch。版本常量见 `scripts/enterprise-desktop-plugins.mjs`；**安装包强制 seed / 覆盖** profile 中的同名包（含曾用 registry/link 安装的 `dsh-mobile`），换版随新安装包，不做运行时自动升。企业 FRP 预置：`node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-frp.mjs`。
手机模块若被裁空导致白屏：`node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-modules.mjs`（默认 reset 回全量），手机整页刷新后再开。激进减负需先做冒烟，勿直接当默认。

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
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-mobile-cowatch
```


3. 启动：`pnpm dsh web`（已在跑则重启，或依赖 HMR 视改动面而定）。
4. Host 半截可单独：`pnpm dsh web --patch ./tsy-custom-plugins/tenant-identity.overlay.yml`；Client 仍以 profile 已装包为准。

换机器或移动仓库后，重新执行上面的 `plugin add`，让 profile 的 `link:` 指向新路径。

## Desktop 开发循环

**顺序固定：先改 Web（`tsy-custom-plugins/`），验证后再 sync/stage 到 Desktop。禁止直接改 `.dsh-trial-plugins`、profile `node_modules`、`.desktop-build/trial-plugins` 或 `win-unpacked` 里的拷贝当主修复路径。**

1. 退出 Desktop。
2. `node ./tsy-custom-plugins/scripts/sync-desktop-plugins.mjs`（把仓库同步到 `~/.dsh/profiles/desktop` 等）。
3. 再开 Desktop（企业联调优先开 **已打进 trial-defaults 的安装包 / win-unpacked**，见下方注意事项；不要默认用裸 `pnpm start:desktop` 验收登录门禁）。

### 注意事项：禁止验收时落到官方欢迎页（登录 / 添加 API Key）

打包或重启后若出现原生窗「欢迎使用 DeepSeek Harness / 组装无限可能… / 登录 / 添加 API Key」，说明 **Electron 欢迎窗**被打开了，企业 `t4y-identity` 登录门禁还没机会接管。这是企业交付里**反复踩过**的坑，验收前必须排除。

| 正确 | 错误 |
|---|---|
| 安装包 `resources/trial-defaults.json` = `desktop-enterprise-defaults.json`（`credentialRef: T4Y_DESKTOP_ENTERPRISE_GATE`） | 漏设 `DSH_DESKTOP_TRIAL_DEFAULTS_FILE`，或指向空/错误文件 |
| 安装包同时带 `resources/trial-plugins/`（含已启用的 `t4y-identity`）并完成 stage | 只 stage 了插件、没带 enterprise defaults |
| Windows：先跑 `ensure-desktop-package-env.mjs`（或 stage，会自动 ensure）再 `package:desktop:win:x64:unsigned` | 跑完 `seed-desktop-trial-defaults.mjs` 后未再跑 ensure，defaults 仍指向 Qwen Key 文件 |
| mac unsigned：shell **export 绝对路径**（不读 `.env.macos`） | 只改了 `.env.macos` 却以为 mac 打包会读到 |
| 验收企业登录：打开 `win-unpacked/DeepSeek Harness.exe` 或已安装 App | 用裸 `pnpm start:desktop` 验收门禁（**未打包进程不读 `trial-defaults.json`**，无官方 Key 时必出欢迎页） |

打包后自检（缺一不可）：

```sh
# Windows 示例
test -f apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/resources/trial-defaults.json
# 内容须含 T4Y_DESKTOP_ENTERPRISE_GATE；且 resources/trial-plugins/t4y-identity 存在
```

临时误开 `start:desktop` 时：欢迎页点「添加 API Key」→「稍后」可进工作区再看到企业门禁；**正式交付与冒烟仍必须以带 enterprise defaults 的安装包为准**。

### UI 约束：禁止出现在「已安装插件」

左上角 **插件 → 已安装插件** 用于普通第三方包；企业平台包和表单管理的插件由 `t4y-release-manager` 在 Host 侧过滤，表单管理的插件通过 **设置 → 授权插件** 操作。profile 的 `bundles` 勿残留无对应 `dependencies` 的包名；过滤范围以该插件的实际包集合和发布状态为准。

### 常见坑：本机 Web 正常、安装包 / 干净 clone 却炸

Web / Desktop profile 常用 `link:` 指向 `tsy-custom-plugins/<pkg>`。**Junction 会带上未跟踪文件**，所以本机改完立刻能跑；`stage-desktop-trial-plugins.mjs` 却只复制各包 `package.json` 的 `files` 列表。

因此会出现：本机联调正常 → 打出的 Desktop trial 缺 sibling 模块 → Host `import './…'` 直接失败。已经踩过一次：`t4y-mobile-cowatch` 新增 `per-host-origin.js` 并被 `index.js` import，但未写入 `files`、也未提交，stage 产物缺文件。

| 注意 | 原因 |
|---|---|
| 新增 Host 本地 `.js` 并被 `import` | 必须进 `package.json` → `files`，并 `git add` |
| 新增 `client-src/` 分片 | 写入 `scripts/bundle-client.mjs` 的 `PART_FILES`，跑 bundle，源文件也要提交（只交生成的 `client.js` 不够维护） |
| 输入框「技能」依赖 `ui-input-trigger.toggleTrigger` | hub 与该 API 须同批交付；只 stage hub、核心包仍是旧构建会点按钮失败。成功判定须把「已开再点关闭」算成功，不能只看 `menu.open` |
| FRP `frpc.toml` 被 stop 删掉但进程残留 | cowatch 只杀自有僵死 frpc 并 `needReconnect`；**toml/启动只走 dsh-mobile 官方 remote API**，禁止双写双拉 |
| 手机「已连接」不刷新 | Gateway/Host 见设备 cookie 即记在线（流量即心跳）；不要依赖手机 CSRF presence POST |
| stage 后自检 | 脚本会核对 `files` 是否落盘；改完务必 `node …/stage-desktop-trial-plugins.mjs` 再打包 |

## 打试用安装包（Mac unsigned）

无符号 mac 打包**不会**读 `.env.macos` 里的 trial 路径，必须在进程环境里给出**绝对路径**：

```sh
node ./tsy-custom-plugins/scripts/stage-desktop-trial-plugins.mjs  # 含 dsh-mobile@钉死版 + 全套 t4y-*
# 企业登录包（武汉地铁默认）：非秘密 gate，跳过官方欢迎页 → t4y-identity 门禁。
# 切勿漏掉；否则首屏会变成「登录 / 添加 API Key」。
export DSH_DESKTOP_TRIAL_DEFAULTS_FILE="$PWD/tsy-custom-plugins/desktop-enterprise-defaults.json"
# 仅当明确要打「内置试用模型 Key」包时才改用 seed-desktop-trial-defaults.mjs；
# 跑完 seed 会改写 .env.windows，企业包务必再改回上一行路径。
# node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs

export DSH_DESKTOP_TRIAL_PLUGINS_DIR="$PWD/apps/desktop/.desktop-build/trial-plugins"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # 按需

# 需 Node ^22.19 或 >=24（import.meta.main + native headers）
node --import tsx/esm scripts/build.ts --profile official
pnpm run package:desktop:mac:arm64:unsigned
```

产物：`apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/*.dmg`。

正式给用户用：把 `.app` 装进 `/Applications`（或 Windows 安装器），不要长期从 DMG / 临时目录直接跑。插件依赖会 seed 到用户 profile 的 `.dsh-trial-plugins/`，不绑安装盘路径。

Windows unsigned（团队共用非秘密地址已写死，一条命令即可）：

```sh
node ./tsy-custom-plugins/scripts/ensure-desktop-package-env.mjs
node ./tsy-custom-plugins/scripts/stage-desktop-trial-plugins.mjs
pnpm run package:desktop:win:x64:unsigned
```

`ensure-desktop-package-env.mjs` 会写入/合并 `apps/desktop/.env.windows`：`APP_ID`、HTTPS 占位 origin、`npmmirror`、以及指向 `desktop-enterprise-defaults.json` 的绝对路径；**不覆盖**本机签名/COS 等密钥行。`stage` 只会 upsert `TRIAL_*` 行，不会整文件冲掉 env。打包成功后会自动跑 `assert-enterprise-package.mjs`（缺 `T4Y_DESKTOP_ENTERPRISE_GATE` 或 `trial-plugins/t4y-identity` 则失败）。

Desktop CI 也可通过 `DSH_PACKAGING_CONFIG_DIR` 和 `DSH_PACKAGING_PRESET` 读取机器目录下的公开预设及独立签名密钥文件；公开预设不接受签名 PIN 或对象存储密钥。无签名或仅准备模式如何读取签名文件，以 [加载器](../apps/desktop/scripts/desktop-package-environment.mjs) 为准，密钥不得提交到仓库。

## Hub / 授权插件发布

1. 在 Gitee Hub 按 `{projectName}/plugins/{name}/` 放不可变版本与 `latest.json`。
2. 企业后台菜单叶子表单的必填字段标题为 `插件名`、`项目名`；展示分类和图标使用可选字段 `插件种类`、`插件图标`。
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

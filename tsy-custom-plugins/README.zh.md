# tsy-custom-plugins

[English](README.md) | 中文

此 fork 的树外定制插件，不属于 harness 的 `packages/*/*` 工作区。

本目录包含插件包、独立 Key Broker 服务和 Hub 发布资料。配置使用**包名**或**相对于补丁文件的路径**，不使用本机绝对路径；在另一台机器上完成一次 profile 安装后即可使用。

**开发规范、联调与打包：** 见 [DEVELOPING.md](./DEVELOPING.md)。各插件的职责、流程、状态和边界见 [PLUGIN-REFERENCE.md](./PLUGIN-REFERENCE.md)，各包配置以包内 `README.md` 和源码为准。

## Desktop profile（未打包与打包）

Desktop 和 Web 使用独立 profile。退出 Desktop 后，将所有 `t4y-*` 插件同步到 `~/.dsh/profiles/desktop` 和开发 home profile：

```sh
node ./tsy-custom-plugins/scripts/sync-desktop-plugins.mjs
```

将 Bailian/`QWEN_TOKEN_PLAN_API_KEY` 写入私有 Desktop 安装包（文件被 Git 忽略）：

```sh
node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs
```

文件写入 `apps/desktop/.desktop-build/`（例如 `t4y-trial-defaults.json`）。**未签名 mac** 打包时，在 shell 中导出绝对路径 `DSH_DESKTOP_TRIAL_PLUGINS_DIR` / `DSH_DESKTOP_TRIAL_DEFAULTS_FILE`；未签名 mac 不从 `.env.macos` 读取这两个路径。Windows：填写 `apps/desktop/.env.windows` 后执行 `pnpm run package:desktop:win:x64:unsigned`。完整步骤见 [DEVELOPING.md](./DEVELOPING.md)。安装包可以提取 Key，因此只能使用受限 Key。

不内置模型 Key 的企业登录构建应将 `DSH_DESKTOP_TRIAL_DEFAULTS_FILE` 设为 `tsy-custom-plugins/desktop-enterprise-defaults.json` 的绝对路径。该非秘密标记选择现有 Desktop 试用启动路径，由企业插件提供登录界面；它不是模型凭据。构建还必须包含并启用 `t4y-identity`。

## 安装到 Web profile（推荐）

在仓库根目录执行（先运行 `pnpm install`）：

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-release-manager
pnpm dsh --profile web --dump-config
```

然后正常启动 Web（`pnpm dsh web`）；如果 Web 已运行，重新启动。

更换机器或移动仓库后，重新运行相同的 `plugin add`，使 profile 的 `link:` 指向新的绝对路径。仓库本身保持可移植；只有 `$DSH_HOME/profiles/<name>` 是机器本地配置。

## 通过企业 API 检查插件表单

只读菜单探测脚本使用与 `t4y-identity` 相同的 RSA 登录协议，然后读取所选项目的授权菜单。通过环境变量传入凭据；脚本不打印 access token。

```sh
ENTERPRISE_NAME=example ENTERPRISE_USER=example ENTERPRISE_PASSWORD=example \
  T4Y_MODULE_ID=123 node ./tsy-custom-plugins/scripts/probe-plugin-menu.mjs
```

设置 `T4Y_FORM_ID` 后可检查一个表单叶子，并通过系统的 `fieldQuery` 接口读取数据。如果授权菜单不包含该叶子，脚本会在请求前停止。

## 仅 Host 覆盖配置开发

```sh
pnpm dsh web --patch ./tsy-custom-plugins/tenant-identity.overlay.yml
```

该命令直接从仓库启动 Host 部分。Web Client 部分从已安装的 profile 包中发现，端到端界面验证请使用上面的 Web profile 安装命令。`cordis.yml` / overlay 引用自身附近的路径，不要在此提交绝对路径。

## 插件

| 目录 | 包 | 职责 | 开发指南 |
|---|---|---|---|
| `t4y-tenant/` | `t4y-tenant` | 系统 `tenantId` + 企业 `moduleId` 上下文 | [DEVELOPING](./t4y-tenant/DEVELOPING.md) |
| `t4y-identity/` | `t4y-identity` | 强制登录门禁；会话 `tenantId`（系统）+ `moduleId`（企业） | [DEVELOPING](./t4y-identity/DEVELOPING.md) |
| `t4y-brand/` | `t4y-brand` | 侧栏 / 首屏品牌 | [DEVELOPING](./t4y-brand/DEVELOPING.md) |
| `t4y-trial-runtime/` | `t4y-trial-runtime` | 试用内置模型与联网搜索默认 | [DEVELOPING](./t4y-trial-runtime/DEVELOPING.md) |
| `t4y-capability-hub/` | `t4y-capability-hub` | 设置页 **授权插件** | [DEVELOPING](./t4y-capability-hub/DEVELOPING.md) |
| `t4y-release-manager/` | `t4y-release-manager` | 按授权 + `latest.json` 安装不可变版本 | [DEVELOPING](./t4y-release-manager/DEVELOPING.md) |
| `oa-helper/` | `oa-helper` | 办公表单（Hub：oa-helper） | [DEVELOPING](./oa-helper/DEVELOPING.md) |
| `t4y-key-broker/` | — | 独立 Key Broker 服务 | [DEVELOPING](./t4y-key-broker/DEVELOPING.md) |
| `hub-projects/` | — | Hub catalog / latest 本地样板 | [DEVELOPING](./hub-projects/DEVELOPING.md) |

## HTML 原型

`prototype/versions/v1.1-tenant-identity/pages/index.html`

## 添加其他插件

1. 创建 `tsy-custom-plugins/<name>/`，包含 `package.json`（`dsh.bundle.patch`）、`cordis.patch.yml`（`name: <package-name>`）和插件入口。
2. 可选：添加 `cordis.yml`，以 `name: ./index.js` 支持 `--patch` 开发。
3. 使用 `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>` 安装。
4. 能力类插件追加到 Hub 对应租户的 `catalog.json`（`releases` 只增不改），不要再改 capability-hub 硬编码列表。

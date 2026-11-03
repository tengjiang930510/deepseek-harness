# tsy-custom-plugins

Out-of-tree custom plugins for this fork. Not part of the harness `packages/*/*` workspace.

Plugin packages, the independent Key Broker service, and Hub publishing material live in this tree. Config uses **package names** or **paths relative to the patch file** — never machine-specific absolute paths — so a checkout works on another machine after a one-time profile install.

**开发规范、联调与打包：** 见 [DEVELOPING.md](./DEVELOPING.md)。各插件的职责、流程、状态和边界见 [PLUGIN-REFERENCE.md](./PLUGIN-REFERENCE.md)，各包配置以包内 `README.md` 和源码为准。

## Desktop profile (unpackaged + packaging)

Desktop uses a separate profile from Web. After quitting Desktop, sync every `t4y-*` plugin into both `~/.dsh/profiles/desktop` and the development home profile:

```sh
node ./tsy-custom-plugins/scripts/sync-desktop-plugins.mjs
```

To bake the Bailian/`QWEN_TOKEN_PLAN_API_KEY` into a private Desktop installer (gitignored):

```sh
node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs
```

This writes under `apps/desktop/.desktop-build/` (e.g. `t4y-trial-defaults.json`). For **unsigned mac** packaging, export absolute `DSH_DESKTOP_TRIAL_PLUGINS_DIR` / `DSH_DESKTOP_TRIAL_DEFAULTS_FILE` in the shell (unsigned mac does not load `.env.macos` for those). Windows：填 `apps/desktop/.env.windows` 后 `pnpm run package:desktop:win:x64:unsigned`。完整步骤见 [DEVELOPING.md](./DEVELOPING.md)。The key is extractable from the installer — use only a limited key.

For enterprise-login builds that do not embed a model key, set `DSH_DESKTOP_TRIAL_DEFAULTS_FILE` to the absolute path of `tsy-custom-plugins/desktop-enterprise-defaults.json`. This non-secret marker selects the existing Desktop trial startup path so the enterprise plugin owns the login screen; it is not a model credential. The build must also include and enable `t4y-identity`.

## Install into the Web profile (preferred)

From the repository root (after `pnpm install`):

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-release-manager
pnpm dsh --profile web --dump-config
```

Then start Web as usual (`pnpm dsh web`). Restart if a Web process was already running.

On a new machine or after relocating the checkout, run the same `plugin add` again so the profile’s `link:` points at the new absolute path. The repo itself stays portable; only `$DSH_HOME/profiles/<name>` is machine-local.

## Inspect a plugin form through the enterprise API

The read-only menu probe signs in with the same RSA login protocol as `t4y-identity`, then reads the selected project's permitted menu. Pass credentials through the environment; the script never prints the access token.

```sh
ENTERPRISE_NAME=example ENTERPRISE_USER=example ENTERPRISE_PASSWORD=example \
  T4Y_MODULE_ID=123 node ./tsy-custom-plugins/scripts/probe-plugin-menu.mjs
```

Set `T4Y_FORM_ID` to inspect one form leaf and read its data with the system's `fieldQuery` endpoint. The script stops before that request if the authenticated menu does not contain the leaf.

## Host-only overlay iteration

```sh
pnpm dsh web --patch ./tsy-custom-plugins/tenant-identity.overlay.yml
```

This starts the Host halves directly from the checkout. Web Client halves are discovered from installed profile packages, so use the Web profile installation commands above for end-to-end UI verification. `cordis.yml` / overlay references paths next to themselves. Do not commit absolute paths here.

## Plugins

| Directory | Package | Role | 开发指南 |
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

## Adding another plugin

1. Create `tsy-custom-plugins/<name>/` with `package.json` (`dsh.bundle.patch`), `cordis.patch.yml` (`name: <package-name>`), and the plugin entry.
2. Optional: `cordis.yml` with `name: ./index.js` for `--patch` iteration.
3. Install with `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>`.
4. 能力类插件追加到 Hub 对应租户的 `catalog.json`（`releases` 只增不改），不要再改 capability-hub 硬编码列表。

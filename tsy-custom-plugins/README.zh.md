# tsy-custom-plugins

[English](README.md) | 中文

此分支的树外自定义插件，不属于 Harness 的 `packages/*/*` 工作区。

每个子目录都是一个可安装包。此目录中的配置使用**包名**或**相对于 patch 文件的路径**，不写入特定机器的绝对路径。

## Desktop profile（未打包运行与打包）

源码 Desktop 会自动将这些 bundle 注册到自身独立的开发 profile。在仓库根目录启动：

```sh
pnpm run dev:desktop
```

profile 路径、重复启动行为和跳过构建的启动命令见 [Desktop 开发](../apps/desktop/README.zh.md#develop)。Windows 打包会自动携带这些 bundle 和仓库根目录可选的 `.env`；首次启动默认值、显式资源覆盖、浏览器要求，以及无需 `.env.windows` 的未签名本地打包见 [Windows 安装器资源](../apps/desktop/README.zh.md#windows-installer-interface)。内嵌凭据可以从安装包中提取。

## 源码 Web 启动

在新机器的仓库根目录运行：

```sh
pnpm install
pnpm run build
pnpm dsh web
```

产物构建会为此目录下的每个 bundle 准备依赖，并执行其声明的构建脚本。依赖的生命周期脚本不会执行；使用浏览器的能力可能仍需要按各插件文档安装浏览器。源码 Web 启动器在启动前，将新发现的 bundle 注册到当前 `$DSH_HOME/profiles/web`（默认为 `~/.dsh/profiles/web`）。`start:web` 和 `dev:web` 使用相同的注册流程。

注册流程在仓库移动后更新保留的本地链接，保留用户禁用和移除插件的选择，并且不修改从注册表安装的副本。`source-plugins.json` 标记文件分别保存在各 profile 中。要恢复主动移除的 Web 插件，可执行 `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>`。发布后的安装不使用源码注册机制。

## 开发 overlay（不安装到 profile）

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

`cordis.yml` 引用同目录的 `./index.js`，不要在其中提交绝对路径。

## 插件

| 目录 | 包 | 用途 |
|---|---|---|
| `t4y-brand/` | `t4y-brand` | 武汉地铁 logo 与侧栏名称**武汉地铁智能助手** |
| `t4y-capability-hub/` | `t4y-capability-hub` | 设置页签**武汉地铁能力插件**（启停列表） |
| `t4y-review/` | `t4y-review` | 办公表单与审查命令 |
| `t4y-model-defaults/` | `t4y-model-defaults` | 默认模型和搜索设置；见[密钥与迁移说明](t4y-model-defaults/README.zh.md) |
| `t4y-bilibili-search/` | `t4y-bilibili-search` | 工具 `bilibili_video_search`（内置 Playwright，`src/`） |

## 添加其他插件

1. 创建 `tsy-custom-plugins/<name>/`，包含 `package.json`（声明 `dsh.bundle.patch`）、`cordis.patch.yml`（使用 `name: <package-name>`）和插件入口。
2. 可选：创建使用 `name: ./index.js` 的 `cordis.yml`，通过 `--patch` 迭代开发。
3. 执行 `pnpm run build`，随后重启 `pnpm dsh web`，准备并注册新 bundle。
4. 如果插件需要显示在**武汉地铁能力插件**中，在 `t4y-capability-hub/client.js` 的 `CAPABILITY_PACKAGES` 中添加一项。

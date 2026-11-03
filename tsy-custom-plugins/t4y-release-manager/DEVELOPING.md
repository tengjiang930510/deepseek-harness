# t4y-release-manager 开发指南

产品行为见 [README.md](./README.md)。

## 职责

Host 服务 `t4yReleaseManager`：按企业 Token + `moduleId` 读授权表单，拉取 Gitee `latest.json`，委托 DSH `pluginManager` 安装不可变 git commit；状态在 profile `.dsh-plugin-releases.json`。

## 依赖

- **被谁用：** `t4y-capability-hub`（授权列表 / 安装 / 启停）。
- **依赖：** 企业后端菜单与 `fieldQuery`；Gitee Hub；DSH pluginManager。
- **无 Client 半**（纯 Host）。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` | 全部 Host API：`authorized-plugins`、`install-authorized`、`apply-module`、`listAllBundles` 等 |
| `cordis.patch.yml` | 注册服务与路由 |

## 本地开发

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-release-manager
pnpm dsh web
```

改 `index.js` 后必须重启 Host。可用浏览器或 curl 打本机 `/api/t4y-release/*`（需有效 Authorization）。

## 验证

- 已登录：`POST /api/t4y-release/authorized-plugins` 只返回当前项目菜单里的 `插件名`+`项目名`。
- 安装：重复校验授权后再下 `latest.json`；profile 出现对应 commit 记录；插件可 enable。
- 未授权或伪造 projectName：安装失败，不写 node_modules。
- 切项目：`POST /api/t4y-release/apply-module` 关闭新项目未授权的已管理包，并记录自动关闭状态；切回有权限的项目时恢复这些插件，用户手动关闭的插件保持关闭。旧版本已关闭且没有记录的插件需要手动开启一次。

## 发布注意

- Desktop trial seed 必含。
- `latest.json` 的 `git.commit` / `source.commit` 必须是 40 位且不可变；更新发新版本目录，不改旧 commit 内容。

## 常见坑

- 启停 UI 需要完整 bundle 状态：对外暴露 `listAllBundles`（或等价），不要只用过滤后的已启用列表。
- 不要手改 `node_modules` 装包；一律走 pluginManager。

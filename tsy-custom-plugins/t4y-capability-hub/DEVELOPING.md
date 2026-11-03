# t4y-capability-hub 开发指南

产品行为见 [README.md](./README.md)。

## 职责

设置 → **授权插件**：按当前项目菜单叶子的 `插件名` + `项目名` 展示可装插件；开关交互对齐系统 Plugins（乐观更新、装包后启停）。并 patch 隐藏系统插件库存入口。

## 依赖

- **Host：** `t4y-release-manager`（授权列表 / 安装）。
- **Client inject：** locale、settings-plugins、api-remotes；`immediately: true`。
- **被谁用：** `t4y-identity` client 会 `require` 并 `apply` 本包。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` | Host 半（若有本地 API 代理则在此） |
| `client.js` | 「授权插件」页、开关、`hubCopy` 文案 |
| `cordis.patch.yml` | 设置分区 order、禁用系统插件 UI |

## 本地开发

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-release-manager
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
pnpm dsh web
```

改文案只动 `client.js` 内 `hubCopy`。设置 tab 顺序用 patch 里的 `order`（避免与「Agent 预设」等冲突）。

## 验证

- 登录并进入有授权表单的项目 → 设置里只见授权列表，不见系统插件库存。
- 打开开关：未安装则安装 `latest.json` 指向版本；已安装则 enable，无需整页刷新。
- 企业菜单去掉某插件后，再开设置不应再出现（Host 每次重查菜单）。

## 发布注意

- Desktop trial seed 必含；版本变更后重新 stage。
- Hub 上插件坐标与表单字段标题必须是 `插件名`、`项目名`、`插件种类`、`插件图标`。

## 常见坑

- `immediately: true`：client 脚本加载失败会拖垮 web-boot（identity 依赖本包）。
- 不要在本包硬编码插件列表；列表只来自企业菜单 + Gitee `latest.json`。
- Switch 状态需用 `listAllBundles` / 完整 bundle 状态，过滤后的 `listBundles` 会导致「永远关」。

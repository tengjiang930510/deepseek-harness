# t4y-brand 开发指南

产品行为见 [README.md](./README.md)。

## 职责

侧栏与会话首屏品牌名 / logo：默认占位；登录后跟 identity 会话（项目优先于企业）。

## 依赖

- **依赖：** `t4y-identity` 发出的品牌 / 会话事件。
- **被谁用：** 仅展示；不参与授权安装。

## 目录

| 文件 | 说明 |
|---|---|
| `client.js` | 品牌 UI（可由脚本生成） |
| `assets/` | 回退 logo |
| `scripts/prepare-logo.mjs` / `gen-client.mjs` | 资源与 client 生成 |

## 本地开发

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
# 换回退图：
node ./tsy-custom-plugins/t4y-brand/scripts/prepare-logo.mjs <source.png>
node ./tsy-custom-plugins/t4y-brand/scripts/gen-client.mjs
pnpm dsh web
```

## 验证

- 未登录：占位名 + 内置图。
- 登录后：项目名 / logo；切项目即时更新。
- 远程 logo 404：回退内置图，不炸整页。

## 发布注意

- 属 Desktop trial seed。改 assets 后务必跑 gen-client，再 stage 打包。

## 常见坑

- 不要在 brand 里读企业 HTTP；只消费 identity 已写入的会话字段。

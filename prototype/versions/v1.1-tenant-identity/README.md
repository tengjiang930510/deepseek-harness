# v1.1 租户登录与能力回滚 · HTML 原型

## 打开方式

本地直接打开：

`prototype/versions/v1.1-tenant-identity/pages/index.html`

## 覆盖范围

| 页面 | 内容 |
|---|---|
| 强制登录 | 对齐 DSH SignInDialog/Modal（遮罩 + 380px 卡片 +「开始使用」+ 登录/填入演示账号） |
| 能力页 | 租户 catalog、启停、版本历史、安装/回滚 |

插件落点：`tsy-custom-plugins/t4y-identity`（不改 `packages/`）。

## 演示账号

| 账号 | 密码 | tenantId |
|---|---|---|
| demo | demo123 | wuhanmetro |
| ops | ops123 | wuhanmetro |

## 平台

Web + Desktop 同构交互（本页为静态 HTML+Tailwind CDN+原生 JS）。

## 图例

- 未登录：全屏登录门禁
- 登出：回默认租户语义，并强制再登录
- 版本历史：只增不改；可回滚到已装或安装历史版

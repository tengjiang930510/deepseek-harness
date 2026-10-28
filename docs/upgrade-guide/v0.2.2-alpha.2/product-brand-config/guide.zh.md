---
kind: upgrade-guide
description: "源码构建读取 product-config/product.yml，替代写死的品牌内容和 Logo 准备脚本。"
---
# 产品配置统一管理名称与图标

[English](guide.md) | 中文

## 变更

源码构建需要 `product-config/product.yml` 及其 PNG 输入图片。产品显示名称、助手 Logo、浏览器资源和桌面安装资源统一使用此文件。源码构建中的产品名称替代 `DSH_CLIENT_TITLE` 覆盖值。品牌插件不再内嵌图片或提供独立的 Logo 生成脚本。源码启动器会拒绝过期的品牌产物。

## 迁移

1. 在 `product-config/product.yml` 中设置 `name` 和 `logo`，可选配置 `appIcon`。路径相对于此文件解析，参见[产品品牌](../../../../product-config/README.zh.md)。
2. 替换引用的 PNG 图片，然后执行 `pnpm run build`。保持 `t4y-brand` bundle 启用。
3. 启动 Web 或桌面端，确认侧栏、新会话标题和应用名称。重新构建并安装桌面包以更新已安装图标。应用 ID、更新渠道和现有用户数据仍单独配置。

# 产品品牌

[English](README.md) | 中文

## 配置

修改 `product.yml` 并替换 `product-assets/` 下的 PNG 图片。每个产品分支维护一份配置。路径相对于 `product.yml` 解析，不受命令工作目录影响。

```yaml
name: 武汉地铁智能助手
logo: ./product-assets/logo.png
appIcon: ./product-assets/app-icon.png
```

`name` 和 `logo` 必填。所有界面语言使用同一个产品显示名称。名称必须符合 macOS 和 Windows 的应用文件名要求。助手 Logo 使用透明背景 PNG，应用图标使用正方形 PNG，建议为 1024 像素。不配置 `appIcon` 时，会使用 Logo 加白色底板和安全留白生成应用图标。

## 构建与运行

修改配置或图片后，在仓库根目录执行：

```sh
pnpm run build
pnpm run start:web
```

桌面端在构建后使用 `pnpm run start:desktop`，或使用 `pnpm run dev:desktop` 完成构建与启动。现有打包命令会包含生成的品牌资源。已安装应用的图标和名称需要重新构建、安装才能更新。macOS Launch Services 和 Windows 资源管理器可能缓存图标，需要重新启动或安装应用。

构建在 `.dsh-build/product/` 下生成资源，并复制到 Web 和桌面产物。不要编辑生成文件。源码启动器和打包流程发现品牌产物缺失或过期时会要求重新构建。生成过程会在发布新资源前拒绝缺失、损坏或不支持的图片。

## 展示范围

产品名称和图片用于侧栏、新会话标题、处理中图标、浏览器标题及 favicon、PWA 安装、桌面欢迎页面和外壳文案、应用图标、Windows 托盘及安装程序图片。保持 `t4y-brand` bundle 启用以显示助手品牌。其包名是安装标识，更换产品时无需改名。

品牌配置不会改变模型、业务工具、凭据、应用 ID、更新渠道、用户数据目录或协议标识。需要独立安装和更新的产品还需明确配置部署参数，参见[桌面配置](../apps/desktop/README.zh.md)。

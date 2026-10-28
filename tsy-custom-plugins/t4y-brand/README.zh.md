# 产品品牌插件

[English](README.md) | 中文

此 bundle 在侧栏、新会话标题和处理中状态显示配置中的产品名称及 Logo。在 [product-config](../../product-config/README.zh.md) 中配置品牌，然后执行 `pnpm run build`。

## 安装

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

源码 Web 和桌面启动器会自动注册此 bundle。客户端读取生成的 `product/brand.json`，注册可释放的 slot 内容。元数据缺失或无效时，会明确报告激活失败。此 bundle 不增加模型输入或工具。

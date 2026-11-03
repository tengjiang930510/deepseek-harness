# t4y-trial-runtime

[English](README.md) | 中文

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-trial-runtime)。

武汉地铁智能助手内置运行时：为试用 / Desktop 安装包提供 Qwen 模型相关默认、联网搜索（flash），并把 LLM / 搜索的凭据引用对齐到 `T4Y_NEW_API_KEY`。

登录与 **New API Key** 签发由 [`t4y-identity`](../t4y-identity/) + Key Broker 完成；本包只消费同一凭据槽，不提供登录 UI，也不自造 Key。

## 安装

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-trial-runtime
```

开发与打包步骤见 [DEVELOPING.md](./DEVELOPING.md)。

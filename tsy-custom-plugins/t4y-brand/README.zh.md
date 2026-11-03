# t4y-brand

[English](README.md) | 中文

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-brand)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

侧栏与会话首屏品牌：默认占位 logo /「智能助手」；登录后由 `t4y-identity` 会话驱动。

| 展示 | 来源 |
|---|---|
| 品牌名 | 当前项目 `module.name`，否则 `enterprise.systemName` |
| Logo | 当前项目 `module.logo`，否则 `enterprise.logo`；失败回退内置图 |

## 安装

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

重新启动 `pnpm dsh web`。

## 资源

- `assets/brand-mark.png` — 未登录或远程 logo 失败时的回退图
- 重新生成回退图：`node scripts/prepare-logo.mjs <source.png>`，再 `node scripts/gen-client.mjs`

# t4y-trial-runtime 开发指南

## 职责

试用 / 内置运行时默认：Qwen 模型相关 seed、联网搜索走 flash、与 Desktop trial 凭据引用配合。不提供登录 UI；不签发模型 Key。

## 依赖

- **配合：** `t4y-identity` 登录后把 New API Key 写入 `T4Y_NEW_API_KEY` 并覆盖/对齐模型列表；本包的 `credentialRef` / `apiKeyEnv` 指向同一槽名。
- **被谁装：** Desktop trial seed；Web 联调可选。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` / `runtime.js` | Host 运行时与默认配置 |
| `cordis.patch.yml` | 打进 profile 的默认行为 |

## 本地开发

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-trial-runtime
pnpm dsh web
```

Desktop：改完后 `sync-desktop-plugins.mjs` 或重新 stage 再打包。

试用默认 Key：

```sh
node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs
```

## 验证

- 干净 profile 首次进入：模型列表/默认与约定一致（`qwen3.8-flash` 优先）。
- 联网搜索工具走 flash，不误用 max。
- 登录经 Broker 签发 New API Key 并写入 `T4Y_NEW_API_KEY` 后，identity 同步的模型仍可用。

## 发布注意

- 属 stage-desktop-trial-plugins 列表。
- 内置 Key 只进 gitignore 构建目录；安装包可被解开，只用限权 Key。

## 常见坑

- 不要在 CLI overlay 里锁死 llm settings，否则 identity 无法写入 New API 模型。
- 与 identity 的默认模型策略保持同一套 id（flash / max）。

# oa-helper 开发指南

产品行为见 [README.md](./README.md)。Hub 插件名一般为 **oa-helper**（`projectName` 如 `wuhanmetro`）。

## 职责

办公申请卡片、请假提交（Playwright）等业务能力。设置页「授权插件」由 `t4y-capability-hub` 提供，不在本包。

## 依赖

- **运行时：** Playwright Chromium（请假自动化）。
- **分发：** 通常经 Gitee Hub + 授权页安装，**不**进默认 Desktop trial seed。
- **同仓参考：** capability-hub / release-manager。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` | Host 工具 / 命令 |
| `client.js` | 卡片与 UI |
| `index.test.js` | 单测 |
| `scripts/` | smoke 等 |

## 本地开发

仓库根：

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/oa-helper
```

本目录依赖：

```sh
cd tsy-custom-plugins/oa-helper
npm install --ignore-workspace
npx playwright install chromium
```

Host 半截：`pnpm dsh web --patch ./tsy-custom-plugins/oa-helper/cordis.yml`。

改版本发布到 Hub 时：更新 `wuhanmetro/plugins/oa-helper/v*` 与 `latest.json`，commits 只增不改。

## 验证

- 单测：`npm test`（在本目录，按 package scripts）。
- 请假冒烟：`npm run smoke:leave`；真正发起加 `LEAVE_SUBMIT=1`。
- 经授权页安装后：会话斜杠仅 `/oa-helper`；提交走 `/oa-helper submit`。

## 发布注意

- Hub `latest.json` 的 `package`、tenant 目录名、Cordis id 必须与菜单叶子 `name` 一致（本包为 `oa-helper`）。
- 企业菜单叶子需能产出 `name=oa-helper`（或你们约定名）与 `projectName`。

## 常见坑

- Playwright 浏览器未安装会导致请假工具运行失败。
- 勿把本包默认打进 trial seed，除非产品明确要求离线预装。

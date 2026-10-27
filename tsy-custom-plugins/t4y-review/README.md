# t4y-review

武汉地铁智能助手：办公申请卡片、`/brand-review`、审查指导，以及办公平台请假「新增」页预览（Playwright）。

设置页 **武汉地铁能力插件** tab 由独立包 [`t4y-capability-hub`](../t4y-capability-hub/) 提供。

## Install

From the repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

In this directory:

```sh
npm install --ignore-workspace
npx playwright install chromium
```

## 办公平台请假提交

请假浏览器实现位于受版本管理的 `src/leave-open.js`，随插件打包分发，无需生成 `lib/` 文件。启动 Web、桌面端或本地冒烟前，请在进程环境中设置 `ZJY_USERNAME` 和 `ZJY_PASSWORD`；缺少任一项时，登录会报错，凭据不得写入源码。

工具 `zjy_leave_submit` 与命令 `/leave-submit`：登录 → 请假申请 → 新增 → 填假别/日期/事由 → 发起流程。

会话请假卡片点「确认并提交到办公平台」会调用 `/leave-submit`（无头浏览器）。

本地冒烟（有头，默认只填表不点发起；`LEAVE_SUBMIT=1` 才会真正发起）：

```sh
npm run smoke:leave
set LEAVE_SUBMIT=1
npm run smoke:leave
```

## Dev overlay

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

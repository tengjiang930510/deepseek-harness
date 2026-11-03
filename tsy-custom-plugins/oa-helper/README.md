# oa-helper

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#oa-helper)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

武汉地铁智能助手：单一斜杠入口 `/oa-helper`（请假 / 出差 / 办公），以及办公平台请假提交（Playwright）。

设置页 **武汉地铁能力插件** tab 由独立包 [`t4y-capability-hub`](../t4y-capability-hub/) 提供。

## Install

From the repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/oa-helper
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

In this directory:

```sh
npm install --ignore-workspace
npx playwright install chromium
```

## 办公平台请假提交

工具 `zjy_leave_submit` 与 `/oa-helper submit {…}`：登录 → 请假申请 → 新增 → 填假别/日期/事由 → 发起流程。

当前仓库缺少运行提交所需的 `lib/leave-open.js`，因此该提交通道会报告模块不可用；卡片生成和本地确认不代表远端流程已提交。

会话请假卡片点「确认并提交到办公平台」会调用 `/oa-helper submit`（无头浏览器）。斜杠菜单只暴露 `/oa-helper` 一项。

在 `/oa-helper` 后描述申请事项，模型会提取已知信息并生成待确认卡片；未明确的信息留空。卡片显示在本轮内容末尾，生成成功后结束本轮，发送命令不会自动提交办公申请。刷新后仍可查看卡片。

本地冒烟（有头，默认只填表不点发起；`LEAVE_SUBMIT=1` 才会真正发起）：

```sh
npm run smoke:leave
set LEAVE_SUBMIT=1
npm run smoke:leave
```

## Dev overlay

```sh
pnpm dsh web --patch ./tsy-custom-plugins/oa-helper/cordis.yml
```

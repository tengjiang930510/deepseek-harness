# t4y-bilibili-search

[English](README.md) | 中文

铁四院能力：B站视频搜索。Playwright 实现在本包 `src/`，构建产物为 `lib/search.js`，不再依赖外部 `enterprise-browser-skills` 仓库。

## Layout

```text
src/browser.ts                 # chromium.launch / session
src/bilibili-video-search.ts   # 搜索、排序、抽字段
lib/search.js                  # esbuild 产物（runtime 加载）
auth/                          # 可选 Playwright storageState（bilibili.json）
```

## Install

From the harness repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-bilibili-search
```

`prepare` / `postinstall` 会构建 `lib/search.js` 并尝试 `playwright install chromium`。离线可设 `T4Y_BILIBILI_SKIP_BROWSER_INSTALL=1`，再手动：

```sh
cd tsy-custom-plugins/t4y-bilibili-search
pnpm install
pnpm exec playwright install chromium
pnpm run build
```

Restart `pnpm dsh web`. Ask e.g.「在 B 站按最多播放搜刘欢」— 模型应调用 `bilibili_video_search`。

也可以输入 `/bilibili 刘欢 最多播放 10条`。命令把搜索请求提交给当前 Agent，由模型调用 `bilibili_video_search` 并在会话中回复；已有任务运行时，请求在下一个 step 处理。空参数返回错误，不启动搜索。

可选：`config.headed: true` 或环境变量 `HEADED=1` 显示浏览器窗口。登录态可放到 `auth/bilibili.json`（Playwright storageState）。

## Settings

若已安装 `t4y-capability-hub`，可在 **设置 → 内置插件 → 铁四院能力插件** 中启停本包。

## Test

在本包目录运行 `npm test`，验证命令提交搜索请求、拒绝空关键词及提交失败；测试不启动浏览器或调用模型。

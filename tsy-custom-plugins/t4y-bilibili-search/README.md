# t4y-bilibili-search

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

可选：`config.headed: true` 或环境变量 `HEADED=1` 显示浏览器窗口。登录态可放到 `auth/bilibili.json`（Playwright storageState）。

## Settings

若已安装 `t4y-capability-hub`，可在 **设置 → 内置插件 → 铁四院能力插件** 中启停本包。

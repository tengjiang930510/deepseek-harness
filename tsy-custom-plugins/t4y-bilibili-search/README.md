# t4y-bilibili-search

English | [中文](README.zh.md)

T4Y capability: Bilibili video search. The Playwright implementation lives in this package's `src/` and builds to `lib/search.js`; no external `enterprise-browser-skills` repository is required.

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

`prepare` / `postinstall` build `lib/search.js` and attempt `playwright install chromium`. For offline installation, set `T4Y_BILIBILI_SKIP_BROWSER_INSTALL=1`, then run manually:

```sh
cd tsy-custom-plugins/t4y-bilibili-search
pnpm install
pnpm exec playwright install chromium
pnpm run build
```

Restart `pnpm dsh web`. Ask, for example, "Search Bilibili for Liu Huan, sorted by most plays"; the model should call `bilibili_video_search`.

You can also enter `/bilibili 刘欢 最多播放 10条`. The command submits the search request to the current Agent, whose model calls `bilibili_video_search` and replies in the conversation; if a task is running, the request is handled at the next step. Empty arguments return an error without starting a search.

Optionally, set `config.headed: true` or the environment variable `HEADED=1` to show the browser window. Login state can be saved to `auth/bilibili.json` as Playwright storageState.

## Settings

If `t4y-capability-hub` is installed, enable or disable this package under **Settings → Built-in plugins → T4Y capability plugins**.

## Test

Run `npm test` in this package's directory to verify search-request submission, empty-keyword rejection, and submission failures; tests do not launch a browser or call a model.

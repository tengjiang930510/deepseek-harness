# t4y-review

铁四院智能助手：办公申请卡片、`/brand-review` 与审查指导。

## Install

From the repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review
```

Re-run on each new machine or after moving the checkout (profile `link:` is machine-local).

## Settings

After install, open **设置 → 内置插件 → 铁四院能力插件** to enable or disable this bundle. The tab is registered by this package’s client half (`settings.plugins.tab`).

## Dev overlay

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

Uses `./index.js` relative to this directory — no absolute paths.

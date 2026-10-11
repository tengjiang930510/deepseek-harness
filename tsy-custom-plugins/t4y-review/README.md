# t4y-review

铁四院智能助手：办公申请卡片、`/brand-review` 与审查指导。

设置页 **铁四院能力插件** tab 由独立包 [`t4y-capability-hub`](../t4y-capability-hub/) 提供。

## Install

From the repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

## Dev overlay

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

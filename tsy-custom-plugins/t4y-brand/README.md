# Product brand plugin

English | [中文](README.zh.md)

This bundle displays the configured product name and logo in the sidebar, new-session headline, and running status. Configure branding in [product-config](../../product-config/README.md), then run `pnpm run build`.

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

Source Web and Desktop launchers register this bundle automatically. The client reads generated `product/brand.json` and registers reversible slot occupants. Missing or invalid metadata fails activation visibly. The bundle adds no model input or tools.

---
kind: upgrade-guide
description: "Source builds read product-config/product.yml instead of hardcoded branding and logo preparation scripts."
---
# Product configuration owns names and icons

English | [中文](guide.zh.md)

## Change

Source builds require `product-config/product.yml` and its PNG inputs. Product display names, assistant logos, browser assets, and Desktop installation assets use this file. The source build's product name replaces `DSH_CLIENT_TITLE` overrides. The brand plugin no longer embeds an image or provides its own logo-generation scripts. Source launchers reject stale brand artifacts.

## Migration

1. Set `name` and `logo` in `product-config/product.yml`; optionally set `appIcon`. Paths resolve relative to this file. See [product branding](../../../../product-config/README.md).
2. Replace the referenced PNG files, then run `pnpm run build`. Keep the `t4y-brand` bundle enabled.
3. Start Web or Desktop and confirm the sidebar, new-session title, and application name. Rebuild and reinstall Desktop packages to update installed icons. Application IDs, update channels, and existing user data remain separately configured.

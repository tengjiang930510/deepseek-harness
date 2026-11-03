# t4y-brand

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-brand) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development.

The sidebar and conversation landing page use a placeholder logo and “智能助手” by default; after login, the `t4y-identity` session supplies the branding.

| Display | Source |
|---|---|
| Brand name | Current project `module.name`, or `enterprise.systemName` |
| Logo | Current project `module.logo`, or `enterprise.logo`; falls back to the built-in image on failure |

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

Restart `pnpm dsh web`.

## Assets

- `assets/brand-mark.png` — fallback when signed out or the remote logo fails
- Regenerate the fallback: `node scripts/prepare-logo.mjs <source.png>`, then `node scripts/gen-client.mjs`

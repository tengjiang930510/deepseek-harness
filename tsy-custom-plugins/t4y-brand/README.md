# t4y-brand

Replaces the Web client fish mark with the Wuhan Metro mark and shows **武汉地铁智能助手** in the sidebar. The conversation hero headline is set in `@deepseek-ai/dsh-client-ui-conversation` locales.

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

Restart `pnpm dsh web`.

## Assets

- `assets/brand-mark.png` — trimmed 128px logo embedded into `client.js` and the Chat running-status icon
- Source: `wuhanmetro-mark-transparent.png`

To swap the logo, run `node scripts/prepare-logo.mjs <source.png>`, then `node scripts/gen-client.mjs`, then rebuild `packages/client/ui-chat` with `pnpm run bundle`.

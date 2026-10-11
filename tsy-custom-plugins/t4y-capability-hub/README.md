# t4y-capability-hub

Owns the Settings → **内置插件 → 铁四院能力插件** tab. Lists and enables/disables capability packages; does not implement office forms or Bilibili search.

Edit `CAPABILITY_PACKAGES` and `hubCopy` at the top of [`client.js`](./client.js).

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

Restart `pnpm dsh web`.

# t4y-capability-hub

Owns the Settings → **自定义能力插件** page (a `settings.section` entry, id `t4y-capability`). Lists and enables/disables capability packages; does not implement office forms or Bilibili search. Because this package loads it, the Plugins page also shows the same page on the `t4y-capability-hub` bundle's page through its **配置** control.

Edit `CAPABILITY_PACKAGES` and `hubCopy` at the top of [`client.js`](./client.js).

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

Restart `pnpm dsh web`.

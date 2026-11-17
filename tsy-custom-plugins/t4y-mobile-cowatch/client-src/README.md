# client-src

Phone / desktop co-watch UI sources. Runtime entry remains a single ModuleLoader
file at `../client.js` (profile loaders do not resolve multi-file ESM clients).

| File | Role |
|------|------|
| `shared.js` | Detect, session, hostReady, fetch guards, boot placeholder |
| `phone-styles.js` | Phone CSS injection |
| `phone-waitgate.js` | WaitGate overlay |
| `phone-idle.js` | Idle disconnect |
| `desktop-access.js` | Desktop「移动访问」menu + FRP |
| `phone-switcher.js` | Switch computer / handoff |
| `apply.js` | Cordis `exports.apply` |

Edit these files, then regenerate:

```sh
node scripts/bundle-client.mjs
```

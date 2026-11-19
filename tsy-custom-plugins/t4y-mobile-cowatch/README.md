# t4y-mobile-cowatch

Mobile co-watch policy: the phone **remote-controls the PC DSH Host**. It does not sign in to the enterprise IdP and does not call the intranet Broker / LLM.

## Behavior

| Surface | Behavior |
|---------|----------|
| Desktop UA | **Fully inert**: clears lab flags and leftover inline chrome; `t4y-identity` owns sign-in |
| Mobile UA | Wait for PC `host-session`; reuse Host model key |

Desktop “移动访问” must never be covered or have its sidebar rewritten. `?t4yMobile=1` is honored only under a real mobile UA.

Phone-side scope today:

- Wait overlay (mobile UA only)
- Light settings/menu/bottom-strip cosmetics
- Fetch guards (no Broker issue/revoke, no host-session clear)

**Out of scope:** AppFrame grid rewrites, chat min-width overrides, shortcut seating moves. Phone layout will be redesigned separately.

Client sources live under `client-src/`; run `node scripts/bundle-client.mjs` before `pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-mobile-cowatch`, then restart Web.

**Packaging:** every Host sibling `import`ed from `index.js` (for example `per-host-origin.js`, `handoff.js`) must be listed in `package.json` `files` and committed. A local `link:` profile sees untracked files; Desktop trial stage copies only `files`, so a missing entry breaks packaged Host load. New `client-src` parts must be added to `scripts/bundle-client.mjs` `PART_FILES`, rebundled, and committed with the generated `client.js`.

## Dependencies

Requires `t4y-identity` (`host-session`). See `tenant-identity.overlay.yml` for the local overlay.

## API

| Route | Purpose |
|-------|---------|
| `GET /api/t4y-mobile-cowatch/credential-status` | Whether Host already holds `T4Y_NEW_API_KEY` |
| `POST /api/t4y-mobile-cowatch/bind-device-label` | Rename the active / recent dsh-mobile device to enterprise `displayName` |
| `POST /api/t4y-mobile-cowatch/presence` | Phone tab heartbeat / leave; paired cookie required |
| `GET /api/t4y-mobile-cowatch/connected-devices` | Phones with a fresh presence beat (not historical pair rows) |
| `POST /api/t4y-mobile-cowatch/per-host-origin` | Rewrite FRP `publicOrigin` to this Desktop’s subdomain |

Soft-off releases FRP after ~60s. Multi-host Caddy: `../ops/frp-multi-host-caddy.md`.

QR pair page auto-binds with no fill-in form; empty pairing labels are filled from `host-session.displayName` when `dsh-mobile` is present. Desktop Mobile access UI keeps only the seeded FRP remote channel.

WaitGate phases: `checking` → `waiting_login` / `waiting_key` → `entering`.

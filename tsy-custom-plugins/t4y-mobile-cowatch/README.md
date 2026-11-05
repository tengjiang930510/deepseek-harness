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

After Client edits: `pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-mobile-cowatch`, then restart Web.

## Dependencies

Requires `t4y-identity` (`host-session`). See `tenant-identity.overlay.yml` for the local overlay.

## API

| Route | Purpose |
|-------|---------|
| `GET /api/t4y-mobile-cowatch/credential-status` | Whether Host already holds `T4Y_NEW_API_KEY` |

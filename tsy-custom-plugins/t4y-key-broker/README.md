# t4y-key-broker

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-key-broker) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development. Source is in `tsy-custom-plugins/t4y-key-broker/`; the current evaluation deployment is at `192.10.51.138:4010`.

Issues a **New API inference Key** after login. `t4y-identity` performs account login; Broker verifies identity by calling `getInfo` with the access token.

## Product model (aligned with identity)

| Concept | Meaning |
|---|---|
| `tenantId` | **System-wide** id (login `enterprise.id`); currently there is only one |
| `moduleId` | **Enterprise** id for billing and workspace; regular users have one, administrators can switch between several |
| Model Key | One per enterprise user `userId` |
| `homeModuleId` | `moduleId` at first issuance → New API `mod_<hash>` account |

### Administrator workflow

1. After login select the **enterprise for current work** (`moduleId`) → first issuance assigns the Key and New API usage to that enterprise.
2. Switch to another enterprise → only workspace / menus change; the **same Key** keeps billing at the home from step 1.
3. To bill another enterprise, **log out** in the client (revoke), log in again and select the target enterprise for issuance.

## Behavior

- First issuance: ensure a New API User exists for enterprise `moduleId`, then create the `usr_<userHash>` Token; the ledger has one row per user with `module_id` set to the home enterprise.
- A later issue for the same user before expiry returns the same Key and original expiration, **without renewal or another reveal**; the response includes `homeModuleId`.
- Token expiry comes from `expiresIn` (**seconds**, up to 30 days). Unexpired tokens are not silently renewed; login and issue **after expiry** write a new `expiresAt` without another reveal when the ledger retains Key material.

## Scale and concurrency (tens of thousands of users)

SQLite WAL uses `BROKER_SQLITE_PATH`, defaulting to `broker.db`; startup idempotently upserts the old `state.json`.

| Path | Behavior |
|---|---|
| Repeated issue / status | O(1) per user; `getInfo` cache defaults to 45s |
| First issuance | Serialized only for that user |
| Admin console | Group by Key home `moduleId` (enterprise) |

Use a shared database before running on multiple machines; New API administration and enterprise `getInfo` are typical bottlenecks.

## Run

Copy `.env.example` to an environment file with restricted permissions and run `server.py` (`server.mjs` is an old prototype and is not for scaled deployment).

**Management API:** `sk-` cannot call it; Broker caches a root JWT and uses `New-Api-User` for delegated management.

```http
POST /v1/session/issue
Authorization: <企业 accessToken>
Content-Type: application/json

{"expiresIn": 2592000, "moduleId": "<enterprise-module-id>", "moduleName": "武汉地铁"}
```

Returns `apiKey`, `expiresAt`, `homeModuleId`, `userId` and `tenantId`. Keys are cached in SQLite; admin overview does **not** return a complete `sk-`.

- `POST /v1/session/status`: query the ledger by user (`moduleId` is optional for older clients).
- `POST /v1/session/revoke`: delete the user’s single Key (`moduleId` is ignored).

## Admin console

Lists member Keys by **home enterprise (module)** and can revoke sessions for one user or an entire enterprise home.

1. Set `BROKER_ADMIN_TOKEN`; open `http://<host>:<port>/admin`.
2. APIs: `GET /v1/admin/overview`, `POST /v1/admin/session/revoke`, `POST /v1/admin/project/revoke-sessions`.

Docker recommends `--network host`. Public access requires HTTPS and source restrictions.

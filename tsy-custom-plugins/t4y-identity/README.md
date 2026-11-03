# t4y-identity

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-identity) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development.

Connects to the existing backend login: `publicKey → RSA(PKCS1) 加密密码 → login → Authorization → getInfo / getRouters`. A full-screen gate appears when signed out; after login the account menu shows `user.nickName`.

## Domain ids

| Concept | Source | Meaning |
|---|---|---|
| `tenantId` | Login `enterprise.id` | **System-wide** id; currently there is only one |
| `moduleId` | Module selected from `getRouters` | **Enterprise** id for billing, workspace and authorized menus |
| Hub `projectName` | Enterprise menu form field | Plugin coordinate, distinct from the other ids |

The upstream login body still uses `enterpriseName` as required by the existing backend; the session stores the system id as `tenantId`.

## Login flow

| Step | Endpoint | Description |
|---|---|---|
| Public key | `GET /auth/publicKey` | Read `data.publicKey` (SPKI Base64) |
| Login | `POST /auth/login` | Body: `enterpriseName` / `userName` / RSA-encrypted `password` |
| Token | Response `data.access_token`, `data.expires_in` | `expires_in` is in **minutes** (for example `43200` = 30 days); the client converts it to seconds for Key Broker. Later requests use `Authorization: <access_token>` without the Bearer prefix |
| User information | `GET /system/user/getInfo` | `user.nickName`; `enterprise.id` → session `tenantId` |
| Enterprises | `POST /system/module/getRouters?clientType=0` (empty body) | Enterprises assigned to the account; when none are available, stay at the gate and ask the user to contact an administrator |

## UI

| Surface | Purpose |
|---|---|
| Full-screen gate | Hide other pages while signed out or restoring a session |
| Enterprise selection | Require a selection after login when several `moduleId` values exist; the “更多” menu permits switching |
| Host account menu adapter | “账户登录” while signed out; “切换” and “退出登录” while signed in; confirmation shows nickName |
| `shell.overlay` | Login / enterprise selection / logout confirmation |

Session restore and enterprise switching preserve the current workspace and session; plugin menus and authorization are queried for the current enterprise. Session history is not isolated by enterprise, so existing context remains when a conversation continues after switching.

## Configuration (cordis.patch)

| Field | Description |
|---|---|
| `apiBaseUrl` | Default `https://jgyw.crfsdi.com.cn:51111/backendapi` |
| `brokerBaseUrl` | Required. Key Broker address used by the DSH Host process |
| `newApiBaseUrl` | Required. OpenAI-compatible `/v1` address for New API |

### Model Key (New API required)

The login access token **cannot** call the model directly. Each user has one inference Key; billing is assigned to the enterprise where it was first issued (`homeModuleId` / `keyHomeModuleId`).

| Role | Enterprise (moduleId) | Model Key | New API billing |
|---|---|---|---|
| Regular user | Only one | Issued at login or first selection | Assigned to that enterprise |
| Administrator | Can switch between several | **Same Key**; switching does not reissue it | Assigned to the first enterprise; to change ownership, log out, log in and select the target enterprise |

The Key is written to local slot **`T4Y_NEW_API_KEY`**. Current `moduleId` drives workspace / branding / authorized menus. The browser does not hold the model Key.

| Local endpoint | Purpose |
|---|---|
| `POST /api/t4y-identity/issue-model-key` | Login / restore / first enterprise selection: Broker issues or reuses a Key → write slot → sync `/models` |
| `POST /api/t4y-identity/session-status` | Every minute / on foreground: check local slot and Broker user ledger |
| `POST /api/t4y-identity/revoke-model-key` | Logout: Broker deletes Token and clears the local slot |
| `POST /api/t4y-identity/set-context` | Switch enterprise: update Host `t4yTenant` (`tenantId` + `moduleId`; keep the Key) |
| `POST /api/t4y-identity/project-workspace` | Workspace endpoint; switching projects preserves the current workspace and sessions |

**Expiry / changing a Key (no silent renewal):**

| Case | Behavior |
|---|---|
| Same user issues again before expiry | Same Key and original `expiresAt`; no renewal |
| Login and issue after model Key expiry | Broker writes a new `expiresAt` (does not reveal again when old Key material exists) |
| Switch enterprise (including administrators) | Do **not** reissue; update branding and authorized plugins, preserve current workspace and session; billing stays at `keyHomeModuleId` |
| Administrator changes billing enterprise | Logout (revoke) → login → select the target enterprise for issuance |
| First enterprise selection after login (no Key yet) | Issue once, with `keyHomeModuleId` set to that enterprise |
| Token or model Key expires / status `active: false` | Return to login gate |
| Chat `AUTH` 401 | Clear local slot → return to login |
| Logout | Revoke and clear slot |

**Do not** write `llm-pi-ai` / `agent-default-model` into a CLI `--patch` overlay: it locks `settings.update`. This plugin seeds the enterprise model route in writable settings and replaces `models` after issuance; the default prefers `qwen3.8-flash`.

The deployment offers `qwen3.8-flash` / `qwen3.8-max`; web search always uses proxied `qwen3.8-flash` (`t4y-trial-runtime`).

## Client conventions

- Session key: `localStorage['t4y.identity.session.v1']`(includes access token, `tenantId`, `moduleId`, `llmApiKeyExpiresAt`; **excludes** plaintext model Key)
- Preference key: `localStorage['t4y.identity.prefs.v1']`(retained after logout: login enterprise name, account and last `moduleId`)
- Events: `t4y-identity:session`、`t4y-tenant:changed`、`t4y-brand:changed`
- Bridge: `window.__t4yIdentity`（`getSession` / `getAccessToken` / `getModuleId` / `selectModule` / `logout`）
- Logout revokes the model Key first; expiry, invalid status or chat AUTH clears the slot and returns to the gate
- On later login, skip selection and enter directly if the previous enterprise remains in the list

## Integration

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-tenant
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-identity
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-brand
```

# v1.1 tenant login and capability rollback · HTML prototype

English | [中文](README.zh.md)

## Open

Open locally:

`prototype/versions/v1.1-tenant-identity/pages/index.html`

## Scope

| Page | Content |
|---|---|
| Required login | Matches DSH SignInDialog/Modal (overlay, 380px card, “开始使用”, login and demo account fill) |
| Capabilities | Tenant catalog, enablement, version history, install and rollback |

Plugin location: `tsy-custom-plugins/t4y-identity` (without changing `packages/`).

## Demo accounts

| Account | Password | tenantId |
|---|---|---|
| demo | demo123 | wuhanmetro |
| ops | ops123 | wuhanmetro |

## Platforms

Web and Desktop share the interaction (this page is static HTML, Tailwind CDN and native JS).

## Legend

- Signed out: full-screen login gate
- Logout: return to the default tenant and require login again
- Version history: append-only; roll back to an installed version or install a historical version

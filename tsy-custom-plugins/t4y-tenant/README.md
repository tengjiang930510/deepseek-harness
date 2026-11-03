# t4y-tenant

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-tenant) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development.

Maintains the current system tenant and enterprise module context.

| Concept | Meaning |
|---|---|
| `tenantId` | **System-wide** id (`enterprise.id` returned by login); currently there is only one |
| `moduleId` | **Enterprise** id for billing, workspace and authorized menus; administrators can switch between enterprises |
| `catalogProjectId` | Hub `projectName` slug for plugin coordinates; distinct from tenant and module ids |

There are two views:

| Location | Consumers | Update |
|---|---|---|
| Browser `window.__t4yTenant` | Client UI such as authorization and branding | `t4y-identity` session events |
| Host service `ctx.t4yTenant` | Host plugins such as `t4y-release-manager` | identity `set-context` on login, restore and enterprise switch |

## Example

After logging in and selecting “武汉地铁”:

1. The browser stores `moduleId=该企业`; sidebar branding and authorization follow that enterprise.
2. Host `t4yTenant` receives `tenantId=系统租户` and `moduleId=该企业`.
3. For an authorized installation, release-manager reads the menu for the current `moduleId`; Hub paths still use the menu form's `projectName`.

On another enterprise switch, identity updates Host again; release-manager disables enabled packages not authorized for the new enterprise.

## Configuration

| Field | Default |
|---|---|
| `defaultTenantId` | System tenant default while signed out |
| `catalogProjectId` | Hub catalog / `projectName` slug such as `wuhanmetro`; legacy `catalogTenantId` is also read |
| `catalogUrl` | Hub catalog URL |
| `capabilityPluginIds` | Reserved capability package list |

## Client bridge

`window.__t4yTenant`: `getTenantId` / `getModuleId` / `onChange`.

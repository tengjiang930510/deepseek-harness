# t4y-tenant 开发指南

产品行为见 [README.md](./README.md)。

## 职责

维护当前 `tenantId`（系统级，暂单例）与 `moduleId`（企业）。浏览器桥给 UI；Host 服务给 release-manager 等后台用。不负责登录 UI。

## 依赖关系

- **被谁用：** `t4y-identity` 登录/恢复/切企业写入 Host；Client UI 读 `__t4yTenant`；`t4y-release-manager` 请求体无 `moduleId` 时回退读 Host。
- **不依赖：** Key Broker、Gitee Hub 拉取（只提供 catalog URL / `catalogProjectId`）。

## 目录

| 文件 | 说明 |
|---|---|
| `index.js` | Host：`t4yTenant` 服务 |
| `client.js` | Client：`window.__t4yTenant` 桥 |

## 验证

- 登录后 `getTenantId` 等于登录 `enterprise.id`（系统租户）；`getModuleId` 为所选**企业**。
- 未登录：`getTenantId` 为 `defaultTenantId`（或空）。
- 切企业只改 `moduleId`，`tenantId` 不变。
- `catalogProjectId` 是 Hub slug，不是 `tenantId` / `moduleId`。

## 常见坑

- 不要把 `tenantId` 当成企业；企业是 `moduleId`。
- 不要把 `tenantId` / `moduleId` 当成 Hub `projectName`；授权安装坐标来自菜单表单 `name` + `projectName`。

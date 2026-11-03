# t4y-tenant

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-tenant)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

维护当前「系统租户 + 企业（module）」上下文。

| 概念 | 含义 |
|---|---|
| `tenantId` | **整个系统**的 id（登录返回的 `enterprise.id`）；暂时只会有这一个 |
| `moduleId` | **企业** id（分账 / 工作区 / 授权菜单范围）；管理员可在多个企业间切换 |
| `catalogProjectId` | Hub 上的 `projectName` slug（插件坐标），与 tenant / module 不是同一套 id |

有两份视图：

| 位置 | 给谁用 | 怎么更新 |
|---|---|---|
| 浏览器 `window.__t4yTenant` | 授权页、品牌等 Client UI | 跟 `t4y-identity` 会话事件走 |
| Host 服务 `ctx.t4yTenant` | `t4y-release-manager` 等 Host 插件 | identity 登录/恢复/切企业时 `set-context` |

## 例子

登录后选企业「武汉地铁」：

1. 浏览器记住 `moduleId=该企业`，侧栏品牌和授权页按该企业显示。
2. Host `t4yTenant` 写成 `tenantId=系统租户`、`moduleId=该企业`。
3. 授权安装时 release-manager 按当前 `moduleId` 拉企业菜单；Hub 路径仍用菜单表单里的 `projectName`。

切到另一企业：identity 再写一遍 Host；release-manager 会 disable 上一企业未授权的已启用包。

## 配置

| 字段 | 默认 |
|---|---|
| `defaultTenantId` | 未登录时的系统租户默认值 |
| `catalogProjectId` | Hub catalog / `projectName` slug（如 `wuhanmetro`）；旧名 `catalogTenantId` 仍可读 |
| `catalogUrl` | Hub catalog URL |
| `capabilityPluginIds` | 预留能力包名列表 |

## 客户端桥

`window.__t4yTenant`：`getTenantId` / `getModuleId` / `onChange`。

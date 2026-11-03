# T4Y Release Manager

[English](README.md) | 中文

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-release-manager)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

管理 T4Y Gitee Hub 发布插件的已安装不可变版本。它提供 Host 服务 `t4yReleaseManager`，使插件界面可以独立于 Desktop 交付和升级。

它不会直接修改 `node_modules`。安装交给 DSH profile 的 `pluginManager`，由后者执行常规加锁、校验、启用和重载生命周期。持久状态保存在 profile 的 `.dsh-plugin-releases.json`，每条记录固定到 40 位 Git 提交。

插件运行期间，普通插件列表不显示企业平台包和由表单管理的包；用户在授权插件页面管理后者。卸载插件会恢复被拦截的插件管理器方法。

`POST /api/t4y-release/authorized-plugins` 使用调用方的企业 access token 和 `moduleId` 读取项目菜单及可见表单叶子的 `fieldQuery` 数据。只有包含标题为 `插件名` 和 `项目名` 字段的记录才是插件坐标。`POST /api/t4y-release/install-authorized` 在下载 `{projectName}/plugins/{name}/latest.json` 并安装其引用的不可变提交之前再次检查授权。可选的 `插件种类` 和 `插件图标` 字段提供展示分类和第一张上传图片。Hub catalog 使用 `projectId`（与菜单 `projectName` 同系 slug）；没有「租户」目录。

`POST /api/t4y-release/apply-module` 重新查询当前项目的授权包。它停用不在授权范围内且当前启用的受管理包，并在 profile 中记录自动停用状态。后续项目重新授权时管理器恢复这些包；用户手动停用的包保持关闭。没有自动停用记录的旧禁用包需要用户手动启用一次。

`latest.json` 包含一个当前版本，例如：

```json
{
  "name": "oa-helper",
  "projectName": "wuhanmetro",
  "package": "oa-helper",
  "version": "0.1.0",
  "dsh": "bundle",
  "git": { "repository": "https://gitee.com/eureka96/tsy-dsh-plugins-hub.git", "ref": "master", "commit": "<40-character commit>" },
  "source": { "commit": "<same 40-character commit>", "path": "wuhanmetro/plugins/oa-helper/v0.3.3" }
}
```

`POST /api/t4y-release/authorized-coordinates` 查询当前企业菜单和表单，返回授权插件坐标而不获取 Gitee 发布元数据。客户端可以将坐标与本地缓存的展示资料匹配；该接口不缓存授权。安装和启用使用重新查询授权的路径。

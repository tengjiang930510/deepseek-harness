# T4Y Release Manager

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-release-manager)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

Owns the installed immutable release collection for plugins published by the T4Y Gitee Hub. It provides the `t4yReleaseManager` Host service so the plugin UI can be delivered and upgraded independently of Desktop.

It never edits `node_modules` directly. Installation is delegated to DSH's profile `pluginManager`, which applies its normal locking, validation, enablement and reload lifecycle. The persistent state is stored in the profile as `.dsh-plugin-releases.json`; each record pins a 40-character Git commit.

While the plugin is active, the generic plugin list excludes enterprise platform packages and form-managed packages; users manage the latter in the authorized plugins page. Unloading the plugin restores the intercepted plugin-manager methods.

`POST /api/t4y-release/authorized-plugins` uses the caller's enterprise access token and `moduleId` to read the project menu and the `fieldQuery` data of its visible form leaves. Only records with fields titled `插件名` and `项目名` are plugin coordinates. `POST /api/t4y-release/install-authorized` repeats that check before it downloads `{projectName}/plugins/{name}/latest.json` and installs the referenced immutable commit. The optional `插件种类` and `插件图标` fields provide the display category and first uploaded image. Hub catalog uses `projectId`（与菜单 `projectName` 同系 slug）；没有「租户」目录。

`POST /api/t4y-release/apply-module` rechecks the current project's authorized packages. It disables enabled managed packages absent from that authorization and records those automatic suspensions in the profile. When a later project authorizes a suspended package, the manager restores it; manually disabled packages stay disabled. Previously disabled packages without a suspension record must be enabled once by the user.

`latest.json` contains one current release, for example:

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

`POST /api/t4y-release/authorized-coordinates` performs the current enterprise menu and form queries and returns authorized plugin coordinates without fetching Gitee release metadata. The client may match those coordinates to locally cached display metadata; the endpoint does not cache authorization. Installation and enablement use the fresh authorized release path.

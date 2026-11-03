# t4y-capability-hub

职责、调用流程、状态和边界见 [企业插件实现与边界](../PLUGIN-REFERENCE.md#t4y-capability-hub)。

开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

Owns the Settings → **授权插件** page, shortcut buttons and grouped command suggestions. It asks the Host to read the signed-in user's current project menu, then reads `插件名`, `项目名`, `插件种类`, and `插件图标` records from visible form leaves. Each record resolves its own Gitee `latest.json`; the release manager filters enterprise-managed packages from the generic plugin list.

The Host repeats the menu and form query before install, so changing browser state or directly calling the local install endpoint cannot grant a plugin that the enterprise system did not return. User-facing copy belongs in `hubCopy` in [`client.js`](./client.js).

For a record `{ "name": "oa-helper", "projectName": "wuhanmetro" }`, the Host reads `wuhanmetro/plugins/oa-helper/latest.json` from the Gitee Hub. The document supplies the package name, immutable commit/source coordinate, and current version. The UI only installs or updates that current release.

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

Restart `pnpm dsh web`.

授权插件按表单中的“插件种类”分组；未填写时使用企业菜单中的上级目录。插件图标使用表单中上传的第一张图片，图片不可用时显示默认图标。在插件卡片勾选“在输入框显示快捷按钮”后，已安装并启用的插件命令会出现在会话输入框下方。点击按钮与从斜杠菜单选择命令一样，会插入蓝色命令标记，需用户自行确认发送；输入框已有内容或附件时按钮不可用。选择保存在当前浏览器中，按企业、账号和项目隔离。切换项目或登录状态时会重新查询授权。

输入 `/` 时，已启用插件的命令按表单“插件种类”分组，标题显示匹配的插件数量；每项使用表单上传的图标。

插件使用输入候选来源与菜单槽位展示分类，在展示层合并同名的系统命令并复用 DSH 菜单组件；命令解析和执行继续由 DSH 完成。该适配依赖 DSH 菜单槽位和输入控制器，升级 DSH 时应复验 `/`、`@`、鼠标、键盘与窄窗口行为。

快捷按钮和 `/` 菜单先查询当前企业、账号和项目的授权；同一页面内复用查询结果。刷新页面、重新登录、切换项目或通过授权插件页修改插件状态时重新查询；查询失败时不展示旧授权。企业系统没有变更推送时，页面无法立刻获知管理员在后台收回的权限。

浏览器持久存储只缓存插件名称、图标地址、版本、包名、命令和描述等资料；授权结果只保存在当前页面内存中，不跨页面刷新或账号、项目复用。已缓存的资料仅与当前授权返回的插件匹配；缺少资料或安装版本变化时重新读取发布信息。

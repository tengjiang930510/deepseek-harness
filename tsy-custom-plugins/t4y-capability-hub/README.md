# t4y-capability-hub

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-capability-hub) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development.

Owns the Settings → **授权插件** page, the composer **技能** entry, and grouped `/` command suggestions. It asks the Host to read the signed-in user's current project menu, then reads `插件名`, `项目名`, `插件种类`, and `插件图标` records from visible form leaves. Each record resolves its own Gitee `latest.json`; the release manager filters enterprise-managed packages from the generic plugin list.

The Host repeats the menu and form query before install, so changing browser state or directly calling the local install endpoint cannot grant a plugin that the enterprise system did not return. User-facing copy belongs in `hubCopy` in [`client.js`](./client.js).

For a record `{ "name": "oa-helper", "projectName": "wuhanmetro" }`, the Host reads `wuhanmetro/plugins/oa-helper/latest.json` from the Gitee Hub. The document supplies the package name, immutable commit/source coordinate, and current version. The UI only installs or updates that current release.

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

Restart `pnpm dsh web`.

Authorized plugins are grouped by the form’s “插件种类”, or the parent enterprise menu directory when that field is empty. The icon uses the first uploaded image, falling back to a default. Cards only show enable/disable (and install when missing); there is no per-plugin “show in composer” checkbox. The composer tool row has a single **技能** button that opens the same slash panel as typing `/` (without inserting `/`). Selecting a slash-menu command inserts the blue command marker for the user to confirm and send. Project and login changes trigger another authorization query. Phone co-watch seating is owned by `t4y-mobile-cowatch`.

Typing `/` (or clicking **技能**) groups enabled plugin commands by the form’s “插件种类”; each heading shows the matching plugin count and each item uses the uploaded icon.

The plugin uses an input suggestion source and menu slots to show categories, merges identically named system commands for display and reuses the DSH menu. DSH still parses and executes commands. This adapter depends on DSH menu slots and the input controller; recheck `/`, `@`, mouse, keyboard and narrow-window behavior when upgrading DSH.

The **技能** entry and `/` menu first query authorization for the current enterprise, account and project, then reuse the result within the page. A page refresh, new login, project switch or plugin status change in the authorized page triggers a new query; old authorization is not shown on query failure. Without enterprise change notifications, an open page cannot immediately learn that an administrator revoked access.

Persistent browser storage caches display data such as plugin names, icon URLs, versions, package names, commands and descriptions. Authorization stays only in the current page’s memory and is not reused across reloads, accounts or projects. Cached data is matched only to currently authorized plugins; missing data or an installed-version change triggers another release-information request.

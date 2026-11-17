# tsy-custom-plugins

English | [中文](README.zh.md)

Out-of-tree custom plugins for this fork. Not part of the harness `packages/*/*` workspace.

Each subdirectory is one installable package. Config in this tree uses **package names** or **paths relative to the patch file** — never machine-specific absolute paths.

## Desktop profile (unpackaged + packaging)

Source Desktop automatically registers these bundles in its separate development profile. From the repository root, launch with:

```sh
pnpm run dev:desktop
```

See [Desktop development](../apps/desktop/README.md#develop) for profile paths, repeated-start behavior, and the build-free launch command. Windows packaging automatically carries these bundles and the repository root's optional `.env`; see [Windows installer resources](../apps/desktop/README.md#windows-installer-interface) for first-launch defaults, explicit resource overrides, browser requirements, and unsigned local packaging without `.env.windows`. Embedded credentials can be extracted from the installer.

## Source Web and OpenAI startup

On a new machine, run from the repository root:

```sh
pnpm install
pnpm run build
pnpm dsh web
pnpm dsh openai
```

The artifact build prepares dependencies for each bundle under this directory and runs its declared build script. Dependency lifecycle scripts are skipped; browser-backed capabilities may still require their documented browser installation. The source Web and OpenAI launchers register newly discovered bundles in the active `$DSH_HOME/profiles/web` or `$DSH_HOME/profiles/openai` before booting. Source Desktop uses the same discovery and registration in its selected development home. All three load links to the same checkout packages; their enablement and configuration remain profile-owned. `start:web` and `dev:web` use the same registration.

OpenAI registration includes checkout bundles, not the GUI default npm list. Add each callable custom tool to `openai-server.models[].tools`; loading a plugin does not bypass the route allowlist. Client pages and interactive cards remain available only in Web and Desktop.

Registration updates retained local links after moving the checkout, preserves disabled bundles and user removals, and leaves registry-installed copies untouched. Its `source-plugins.json` marker is local to each profile. To restore a deliberately removed Web plugin, install it with `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>`. Published installations do not use source registration.

Source Web and Desktop also read the default npm bundles from [`apps/desktop/packaged-plugins.json`](../apps/desktop/packaged-plugins.json), which includes `dsh-wechat-plugin`. Each profile installs missing, previously unregistered bundles with `@latest` before startup; the first installation needs registry access. Later starts preserve installed versions, disabled bundles, and deliberate removals. A failed installation stops startup and is retried on the next launch. Windows packaging uses the same list and resolves latest separately for each build.

Bundles may declare `dsh.profiles` as a nonempty list of profile names. Without it, a bundle remains shared. The OpenAI service selects only `openai`; the API history UI selects `web` and `desktop`.

If this checkout previously used the in-tree OpenAI bundle, migrate its existing profile once after building:

```sh
node tsy-custom-plugins/scripts/setup-openai-profile.mjs
```

This backs up the old package manifest, replaces its bundle reference and installs the local service link. It preserves `cordis.patch.yml`, credentials and Session ids. Restart `pnpm dsh openai` and `pnpm dsh web` afterward. Review [upstream compatibility](OPENAI-UPSTREAM.md) when syncing Harness source.

## Dev overlay (no profile install)

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

`cordis.yml` references `./index.js` next to itself. Do not commit absolute paths here.

## Plugins

| Directory | Package | Role |
|---|---|---|
| `t4y-openai-service/` | `t4y-openai-service` | OpenAI-compatible HTTP service, multi-turn Sessions and progress |
| `t4y-openai-ui/` | `t4y-openai-ui` | API badges and read-only history refresh |
| `t4y-brand/` | `t4y-brand` | Wuhan Metro logo + sidebar name **武汉地铁智能助手** |
| `t4y-capability-hub/` | `t4y-capability-hub` | Settings tab **武汉地铁能力插件**（启停列表） |
| `t4y-review/` | `t4y-review` | Office forms + review commands |
| `t4y-model-defaults/` | `t4y-model-defaults` | Default model and search settings; see its [credential and migration instructions](t4y-model-defaults/README.md) |
| `t4y-bilibili-search/` | `t4y-bilibili-search` | Tool `bilibili_video_search`（内置 Playwright，`src/`） |

## Adding another plugin

1. Create `tsy-custom-plugins/<name>/` with `package.json` (`dsh.bundle.patch`), `cordis.patch.yml` (`name: <package-name>`), and the plugin entry.
2. Optional: `cordis.yml` with `name: ./index.js` for `--patch` iteration.
3. Run `pnpm run build`, then restart Web, Desktop, or `pnpm dsh openai` to prepare and register the new bundle.
4. If it should appear under **武汉地铁能力插件**, append an entry to `CAPABILITY_PACKAGES` in `t4y-capability-hub/client.js`.

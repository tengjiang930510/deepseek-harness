# tsy-custom-plugins

English | [中文](README.zh.md)

Out-of-tree custom plugins for this fork. Not part of the harness `packages/*/*` workspace.

Each subdirectory is one installable package. Config in this tree uses **package names** or **paths relative to the patch file** — never machine-specific absolute paths.

## Desktop profile (unpackaged + packaging)

Desktop uses a separate profile from Web. After quitting Desktop, sync every `t4y-*` plugin into both `~/.dsh/profiles/desktop` and the development home profile:

```sh
node ./tsy-custom-plugins/scripts/sync-desktop-plugins.mjs
```

To bake the Bailian/`QWEN_TOKEN_PLAN_API_KEY` into a private Desktop installer (gitignored):

```sh
node ./tsy-custom-plugins/scripts/seed-desktop-trial-defaults.mjs
```

This writes `apps/desktop/.desktop-build/trial-defaults.json` and sets `DSH_DESKTOP_TRIAL_DEFAULTS_FILE` in `apps/desktop/.env.windows`. Then package with `pnpm run package:desktop:win:x64:unsigned` (fill the rest of `.env.windows` from `.env.windows.example` first). The key is extractable from the installer — use only a limited key.

## Source Web startup

On a new machine, run from the repository root:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

The artifact build prepares dependencies for each bundle under this directory and runs its declared build script. Dependency lifecycle scripts are skipped; browser-backed capabilities may still require their documented browser installation. The source Web launcher registers newly discovered bundles in the active `$DSH_HOME/profiles/web` (default `~/.dsh/profiles/web`) before booting. `start:web` and `dev:web` use the same registration.

Registration updates retained local links after moving the checkout, preserves disabled bundles and user removals, and leaves registry-installed copies untouched. Its `source-plugins.json` marker is local to the Web profile. To restore a deliberately removed plugin, install it with `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>`. The published CLI and Desktop profile do not use this source-only preload.

## Dev overlay (no profile install)

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

`cordis.yml` references `./index.js` next to itself. Do not commit absolute paths here.

## Plugins

| Directory | Package | Role |
|---|---|---|
| `t4y-brand/` | `t4y-brand` | Wuhan Metro logo + sidebar name **武汉地铁智能助手** |
| `t4y-capability-hub/` | `t4y-capability-hub` | Settings tab **武汉地铁能力插件**（启停列表） |
| `t4y-review/` | `t4y-review` | Office forms + review commands |
| `t4y-bilibili-search/` | `t4y-bilibili-search` | Tool `bilibili_video_search`（内置 Playwright，`src/`） |

## Adding another plugin

1. Create `tsy-custom-plugins/<name>/` with `package.json` (`dsh.bundle.patch`), `cordis.patch.yml` (`name: <package-name>`), and the plugin entry.
2. Optional: `cordis.yml` with `name: ./index.js` for `--patch` iteration.
3. Run `pnpm run build`, then restart `pnpm dsh web` to prepare and register the new bundle.
4. If it should appear under **武汉地铁能力插件**, append an entry to `CAPABILITY_PACKAGES` in `t4y-capability-hub/client.js`.

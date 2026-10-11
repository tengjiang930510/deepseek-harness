# tsy-custom-plugins

Out-of-tree custom plugins for this fork. Not part of the harness `packages/*/*` workspace.

Each subdirectory is one installable package. Config in this tree uses **package names** or **paths relative to the patch file** — never machine-specific absolute paths — so a checkout works on another machine after a one-time profile install.

## Install into the Web profile (preferred)

From the repository root (after `pnpm install`):

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review
pnpm dsh --profile web --dump-config
```

Then start Web as usual (`pnpm dsh web`). Restart if a Web process was already running.

On a new machine or after relocating the checkout, run the same `plugin add` again so the profile’s `link:` points at the new absolute path. The repo itself stays portable; only `$DSH_HOME/profiles/<name>` is machine-local.

## Dev overlay (no profile install)

```sh
pnpm dsh web --patch ./tsy-custom-plugins/t4y-review/cordis.yml
```

`cordis.yml` references `./index.js` next to itself. Do not commit absolute paths here.

## Plugins

| Directory | Package | Role |
|---|---|---|
| `t4y-capability-hub/` | `t4y-capability-hub` | Settings tab **铁四院能力插件**（启停列表） |
| `t4y-review/` | `t4y-review` | Office forms + review commands |
| `t4y-bilibili-search/` | `t4y-bilibili-search` | Tool `bilibili_video_search`（内置 Playwright，`src/`） |

## Adding another plugin

1. Create `tsy-custom-plugins/<name>/` with `package.json` (`dsh.bundle.patch`), `cordis.patch.yml` (`name: <package-name>`), and the plugin entry.
2. Optional: `cordis.yml` with `name: ./index.js` for `--patch` iteration.
3. Install with `pnpm dsh plugin --profile web add ./tsy-custom-plugins/<name>`.
4. If it should appear under **铁四院能力插件**, append an entry to `CAPABILITY_PACKAGES` in `t4y-capability-hub/client.js`.

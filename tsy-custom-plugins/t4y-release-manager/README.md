# T4Y Release Manager

An initial Desktop plugin that owns the installed immutable release collection and the active pointer for plugins published by the T4Y Gitee hub. It provides the `t4yReleaseManager` host service so the plugin UI can be delivered and upgraded independently of Desktop.

It never edits `node_modules` directly. Installation and activation are delegated to DSH's profile `pluginManager`, which applies its normal locking, validation, enablement and reload lifecycle. The persistent state is stored in the profile as `.dsh-plugin-releases.json`; each record pins a 40-character Git commit.

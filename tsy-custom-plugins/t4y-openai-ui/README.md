---
description: "Identify API-owned Sessions and refresh their read-only history in the Harness GUI."
kind: "package-reference"
---

# t4y-openai-ui

English | [中文](README.zh.md)

## Summary

Show a blue **API** badge in the Session list and read-only header, and refresh persisted messages without starting an Agent. The package consumes the GUI’s generic read-only Session state; it does not acquire write ownership or change the execution service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known limitations](#known-limitations)

## Use this package

Build and check the package from its directory with `pnpm run build` and `pnpm test`. Its JavaScript entries are ready to load without a separate browser bundling step. React and the shared UI primitives come from the serving Harness application.

Install the bundle through the normal GUI profile package manager, for example `pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-openai-ui` from the checkout root, then restart the Web Host and reload the browser. The bundle row enables only in `web` and `desktop`; the OpenAI server profile does not load this UI.

The bundle configures the GUI Session Controller with `readOnlySessionIdPrefixes: ["openai-"]`, preventing Agent activation for the OpenAI service’s Session namespace. Badges require both that namespace and read-only state. Restart the Web Host after installing or removing the bundle so its ownership policy and UI load together.

**Refresh records** rereads the current retained Session’s durable history. Loading disables the button; unavailable history shows a localized failure message. The button does not send prompts, change models, or retain every Session in the list.

## Understand the implementation

The list badge fills `sidebar.session.row.badges` using the row’s id and read-only metadata. Header contributions fill `conversation.session.header.readonly.actions` and `conversation.session.header.readonly.utilities`; the latter consumes the retained Session’s public `refreshHistory()` operation. The plugin owns its dictionaries and private badge styling, and removes both when unloaded.

## Known limitations

- Cross-process updates appear after an explicit refresh; this package does not add live event forwarding between the Web and OpenAI processes.
- Earlier request-isolated Sessions without the `openai-` namespace are not classified by this UI.

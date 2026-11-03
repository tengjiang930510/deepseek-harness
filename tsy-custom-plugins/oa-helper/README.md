# oa-helper

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#oa-helper) for responsibilities, calls, state, and limitations.

See [DEVELOPING.md](./DEVELOPING.md) for development.

The Wuhan Metro assistant provides one slash command, `/oa-helper`, for leave, travel and office requests, and Playwright-based leave submission to the office platform.

The Settings **武汉地铁能力插件** tab is supplied by the separate [`t4y-capability-hub`](../t4y-capability-hub/) package.

## Install

From the repository root:

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/oa-helper
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-capability-hub
```

In this directory:

```sh
npm install --ignore-workspace
npx playwright install chromium
```

## Office platform leave submission

The `zjy_leave_submit` tool and `/oa-helper submit {…}` log in, open a new leave request, fill in the leave type, dates and reason, then start the process.

The repository currently lacks `lib/leave-open.js`, which submission requires. The submission path therefore reports that the module is unavailable; generating and locally confirming a card does not mean a remote process was submitted.

The leave card's “确认并提交到办公平台” button invokes `/oa-helper submit` in a headless browser. The slash menu exposes only `/oa-helper`.

Describe the request after `/oa-helper`; the model extracts known information and creates a card for confirmation, leaving unspecified fields empty. The card appears at the end of the turn, and the turn ends after it is created. Sending the command does not submit a request automatically. Cards remain visible after refresh.

The local smoke opens a visible browser and fills the form without starting the process by default; `LEAVE_SUBMIT=1` starts it:

```sh
npm run smoke:leave
set LEAVE_SUBMIT=1
npm run smoke:leave
```

## Dev overlay

```sh
pnpm dsh web --patch ./tsy-custom-plugins/oa-helper/cordis.yml
```

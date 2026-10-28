---
description: "Default model and web search settings for Wuhan Metro profiles."
kind: "package-bundle"
---

# t4y-model-defaults

English | [中文](README.zh.md)

## Summary

This bundle selects `qwen-token-plan / deepseek-v4.1-flash` as the default model and uses the same endpoint for Bailian web search. Source Web startup discovers it automatically. Desktop profiles receive it through the custom-plugin sync or staging script. Credentials remain separate from the committed configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

From the repository root, copy `.env.example` to the ignored `.env` and fill in `QWEN_TOKEN_PLAN_API_KEY`. Start Web with `pnpm dsh web` after `pnpm install` and `pnpm run build`. The key is required for model calls and Bailian search; a blank value does not authenticate either service.

Transfer `.env` separately when moving by Git, or retain it when copying a private project directory. Source Web reads the invoking directory's `.env`. Desktop needs the same variable in its launch environment or a credential saved in its own Harness home; copying the repository `.env` alone does not configure Desktop. Packaged trial builds may use the existing private trial-defaults resource.

The endpoint and model capacities are stored in [cordis.patch.yml](cordis.patch.yml). A profile's own patch overrides this bundle, so existing local selections remain authoritative. Disable the bundle on the Plugins page to stop applying these defaults.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The bundle configures the existing `llm-pi-ai`, `agent-default-model`, `web`, and `web-search-bailian` rows. It introduces no executable plugin and embeds no API key.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Source Web and Desktop plugin preparation](../README.md)
- [Profile composition](../../../docs/architecture.md#profiles-and-bundles)

<a id="model-experience"></a>
## Model Experience

The configured default selects the model for new Agents. The bundle adds no prompt text or tools; search requests continue through the existing web tool and Bailian provider. Changing a model or provider can change tokenization and cache reuse.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The endpoint must be reachable and the key must be authorized for the configured model. The bundle does not migrate credentials or override an existing profile patch.

<a id="dev-note"></a>
## Dev Note

None.

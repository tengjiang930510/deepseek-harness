---
kind: upgrade-guide
description: "The custom OpenAI service places files from new conversations in dedicated Session directories."
---

# OpenAI service workspace

English | [中文](guide.zh.md)

## Change

The custom `t4y-openai-service` bundle uses `.openai-service-workspace/` under the launch directory as its default model workspace. It previously used the launch directory itself. An explicit `models[].cwd` selects the root. New Sessions use `<root>/<session-id>/` for tool execution and file delivery. Existing Sessions bound to the route root or the launch directory of the default workspace keep their recorded directory. Resuming a Session bound to an unrelated directory returns `409 SESSION_CONFLICT`.

## Migration

1. Launch `pnpm dsh openai` from the project root to use its `.openai-service-workspace/` directory. To switch a profile with an explicit `cwd`, set that model's `cwd` in `$DSH_HOME/profiles/openai/cordis.patch.yml` to the absolute path of the new workspace and restart the OpenAI service.
2. Start a new client conversation, then ask the model to create a file with a relative path. Confirm the file appears in `.openai-service-workspace/<session-id>/`. Continue the conversation to work with the same files.

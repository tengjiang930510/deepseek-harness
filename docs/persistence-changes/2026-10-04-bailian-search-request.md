---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-04-bailian-search-request

English | [中文](2026-10-04-bailian-search-request.zh.md)

## Summary

Adds the required-on-read session event web/bailian-search-llm-request for auxiliary Bailian Responses search.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-bailian-search-request
baseline: false
changes:
  - root: "event:web/bailian-search-llm-request"
    previous: null
    after: "95d60acfcdeb2b92ee667b2a75a3f5879a41208dd29a06add98a8a1d7aed3c99"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Sessions remain valid. Readers that do not know the type refuse a Session that contains it. The payload is the HTTPS endpoint and the secret-free request body; credentials are excluded.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/web/web-search-bailian: provider tests cover secret-free recording before dispatch, source mapping, credential resolution, and cancellation.

<a id="dev-note"></a>
## Dev Note

None.

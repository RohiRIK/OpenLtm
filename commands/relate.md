---
description: "DEPRECATED — use /ltm:memory relate instead. Link two memories with a typed relationship."
disable-model-invocation: true
argument-hint: "<src-id> <tgt-id> <supports|contradicts|refines|depends_on|related_to|supersedes>"
---

> ⚠ **Deprecated:** use `/ltm:memory relate` instead. This alias will be removed in v1.6.0.

Call `mcp__ltm__ltm_relate` with `{ source_id, target_id, relationship_type }`.

| Type | Meaning |
|------|---------|
| `supports` | Source provides evidence for target |
| `contradicts` | Source conflicts with target |
| `refines` | Source is more specific than target |
| `depends_on` | Source requires target |
| `related_to` | General association |
| `supersedes` | Source replaces target (target outdated) |

Report: `Linked [src] → [tgt] (type)`. Duplicates are silently ignored.

---
description: "DEPRECATED — use /ltm:memory recall instead. Search past decisions and memories."
argument-hint: "[search query] [--category gotcha|architecture|pattern|preference|workflow|constraint] [--project name] [--limit N]"
---

> ⚠ **Deprecated:** use `/ltm:memory recall` instead. This alias will be removed in v1.6.0.

Search LTM memories. Call `mcp__ltm__ltm_recall` with parsed args:

| Arg | Field |
|-----|-------|
| positional text | `query` |
| `--category X` | `category` |
| `--project X` | `project` |
| `--limit N` | `limit` (default 10) |

Display each result: ID · content · category · importance ★ · confirmed count · tags · relations.

FTS5 supports `AND`, `OR`, `NOT`, phrase matching (`"bun sqlite"`). Results ranked: relevance → importance → confidence.

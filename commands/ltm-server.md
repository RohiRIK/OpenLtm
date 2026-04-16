---
description: "DEPRECATED — use /ltm:admin server instead. Start, stop, or check the LTM Graph visualization server."
argument-hint: "[start|stop|status]"
allowed-tools: ["Skill", "Bash"]
---

> ⚠ **Deprecated:** use `/ltm:admin server` instead. This alias will be removed in v1.6.0.

Route to the **LtmServer** skill:

| Arg | Workflow |
|-----|----------|
| `start` or no args | `skills/LtmServer/Workflows/Start.md` |
| `stop` | `skills/LtmServer/Workflows/Stop.md` |
| `status` | inline PID check from `skills/LtmServer/SKILL.md` |

Server runs on port **7331**. PID at `~/.claude/tmp/ltm-server.pid`.

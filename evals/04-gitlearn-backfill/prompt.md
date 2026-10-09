---
max_turns: 15
timeout_seconds: 420
allowed_tools: [Read, Glob, Grep, Skill, "Bash(git:*)", Agent, Task]
runs: 3
---

Backfill long-term memory from this repo's last 5 git commits — pull out any decisions or gotchas worth keeping.

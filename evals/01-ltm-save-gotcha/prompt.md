---
max_turns: 8
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
runs: 3
---

Remember this for future sessions: in this repo, bun:sqlite caches prepared statements, so always use .run() for INSERT/UPDATE/DELETE instead of .get(). It bit us twice. Save it to long-term memory.

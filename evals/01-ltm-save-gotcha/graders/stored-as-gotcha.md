---
type: llm
focus: trace
---

Pass only if ALL of these hold:
1. The agent called the OpenLTM `learn` MCP tool (name ends in `memory__learn`) exactly once for this insight — not zero times, and not once per sentence.
2. The stored `content` states both the rule (use .run() for mutations) and the reason (bun:sqlite caches prepared statements).
3. The call passes `category` = "gotcha".
4. The call passes a short `title` (60 characters or fewer).
5. The final message confirms the memory was saved; it does not claim it was saved to a file such as CLAUDE.md or a notes file.

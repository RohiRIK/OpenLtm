---
max_turns: 20
timeout_seconds: 480
allowed_tools: [Read, Glob, Grep, Skill, Write]
runs: 3
---

Before we plan anything: write a spec for adding per-client rate limiting to our API — what we're building, what it must integrate with, and testable acceptance criteria.

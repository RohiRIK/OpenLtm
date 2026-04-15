---
description: "Show project health scores from the LTM graph server."
allowed-tools: ["Bash"]
---

```bash
curl -s http://localhost:7331/api/health/projects
```

If the server isn't running: `LTM server not running — start with /ltm-server`

Parse the JSON and render ranked table (highest score first):

```
SCORE  STATUS           PROJECT              MEMORIES  STALE  CTX
  85   🟢 healthy        claude-config            142      3   4/4
  62   🟡 needs_attention my-app                   38     12   2/4
  31   🔴 neglected       old-project               9      9   0/4
```

Status: 🟢 ≥70 · 🟡 40–69 · 🔴 <40

| Metric | Weight |
|--------|--------|
| Memory freshness (accessed ≤30 days) | 35% |
| Avg confidence | 25% |
| Context coverage (goal/decision/gotcha/progress) | 20% |
| Session activity (any access ≤14 days) | 20% |

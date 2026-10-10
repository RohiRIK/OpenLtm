---
type: llm
focus: last_message
---

Pass only if ALL of these hold:
1. The answer reports the prior decision that refresh tokens live in an httpOnly (SameSite=Strict) cookie and not in localStorage.
2. It gives the reason (XSS could read localStorage) or cites memory #12.
3. It does not invent decisions that are not in the recalled memories (for example a token-rotation scheme or a specific library).

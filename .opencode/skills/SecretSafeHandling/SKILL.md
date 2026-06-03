---
name: secret-safe-handling
description: "USE WHEN handling credentials, env vars, logs, tests, or docs safely."
---

# Secret Safe Handling

Reference secret interfaces without exposing secret values.

## Workflow Routing

| Workflow | Trigger | File |
|---------|---------|------|
| **DesignSecretSafeFlow** | "secret flow", "credential wiring", "env vars", "safe secret access" | `Workflows/DesignSecretSafeFlow.md` |
| **RemoveSecretExposure** | "secret leak", "redact token", "credential exposure", "cleanup secret" | `Workflows/RemoveSecretExposure.md` |

## SkillSearch

- Cloud credential identification: `SkillSearch('secret safe handling cloud credential patterns')` → loads `CloudCredentialPatterns.md`
- Safe handling guidance: `SkillSearch('secret safe handling playbook')` → loads `SecretHandlingPlaybook.md`

## Use This Skill To

- Recognize cloud credential shapes without copying live values.
- Design code, docs, tests, and logs that avoid secret disclosure.
- Remediate accidental exposure using redaction and rotation-oriented workflows.

## Not This Skill

- Not for secret scanning, incident verdicts, or provider-side breach analysis.
- Hand off to @aegis for detection runs, deep audits, or formal security judgments.

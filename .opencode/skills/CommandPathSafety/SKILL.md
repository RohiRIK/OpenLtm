---
name: command-path-safety
description: "USE WHEN hardening command execution, path handling, or installer boundaries."
---

# Command Path Safety

Treat commands and paths as structured, validated inputs.

## Workflow Routing

| Workflow | Trigger | File |
|---------|---------|------|
| **HardenCommandExecution** | "command injection", "shell safety", "exec hardening", "safe subprocess" | `Workflows/HardenCommandExecution.md` |
| **EnforcePathBoundaries** | "path traversal", "zip slip", "installer safety", "path boundaries" | `Workflows/EnforcePathBoundaries.md` |

## SkillSearch

- Command injection guidance: `SkillSearch('command path safety command injection patterns')` → loads `CommandInjectionPatterns.md`
- Path and installer guidance: `SkillSearch('command path safety path traversal installer safety')` → loads `PathTraversalAndInstallerSafety.md`

## Use This Skill To

- Replace shell interpolation with validated structured execution.
- Enforce path roots for writes, extraction, and installer operations.
- Review archive and installer behavior for traversal and boundary escapes.

## Not This Skill

- Not for exploit scanning, malware analysis, or final security verdicts.
- Hand off to @aegis for deep audits, exploitability assessment, or repo-wide review.

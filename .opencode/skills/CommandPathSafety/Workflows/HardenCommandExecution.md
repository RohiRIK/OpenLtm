# HardenCommandExecution

## Use When

Use when code builds shell commands, launches subprocesses, or passes untrusted values into command execution paths.

## Procedure

1. Identify the executable, every argument source, and every place untrusted data could influence parsing.
2. Replace shell-built command strings with structured argv invocation wherever the runtime allows it.
3. Validate attacker-controlled fields for separators, substitutions, globs, newlines, and leading-dash option injection.
4. Insert `--` before positional untrusted values when the target command supports it.
5. Remove `eval`, `exec` string templates, `os.system`, and comparable dynamic shell patterns from the flow.
6. Review TypeScript, Python, and Bash entry points for equivalent weaknesses, then add adversarial tests.

## Done When

- [ ] Commands use explicit executable plus arguments.
- [ ] Metacharacter and option-injection risks are addressed.
- [ ] Dynamic shell construction paths are removed or tightly constrained.
- [ ] Cross-language command execution patterns are consistently hardened.

## Escalate To @aegis When

- You need exploitability assessment for an existing injection path.
- The flow executes downloaded or attacker-supplied programs.
- Repo-wide command execution review is required.

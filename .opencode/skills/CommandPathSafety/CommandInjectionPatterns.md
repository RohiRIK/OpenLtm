# Command Injection Patterns

## Core Rule

Build commands as explicit program plus argument lists whenever possible. Shell syntax is a parser with many dangerous metacharacters, so untrusted data must never be concatenated into command text.

## OWASP-Oriented Injection Vectors

Watch for command separators such as `;`, `&&`, and `||`; command substitution via `$()` and backticks; newline injection; wildcard and glob expansion; variable expansion; and option injection where attacker input is interpreted as flags. When a command accepts positional inputs, use `--` where supported to stop option parsing.

## TypeScript Examples

### Safe

```ts
import { spawn } from "node:child_process";

export function listFile(targetPath: string) {
  return spawn("ls", ["--", targetPath], { stdio: "inherit" });
}
```

### Unsafe

```ts
import { exec } from "node:child_process";

export function listFile(targetPath: string) {
  return exec(`ls ${targetPath}`);
}
```

The unsafe version is vulnerable to separators, substitution, and option injection.

## Python Examples

### Safe

```python
import subprocess


def list_file(target_path: str) -> None:
    subprocess.run(["ls", "--", target_path], check=True)
```

### Unsafe

```python
import os


def list_file(target_path: str) -> None:
    os.system(f"ls {target_path}")
```

## Bash Examples

### Safe

```bash
#!/usr/bin/env bash
set -euo pipefail

target_path="$1"
ls -- "$target_path"
```

### Unsafe

```bash
#!/usr/bin/env bash
set -euo pipefail

target_path="$1"
eval "ls $target_path"
```

Avoid `eval`, unquoted expansions, and string-built commands.

## Reviewing User And Tool Input

Treat filenames, branch names, commit messages, archive names, prompt text, and tool output as hostile until validated. Even benign-looking inputs can hide newlines, wildcard characters, or prefixes like `-rf` that flip program behavior.

## Safe Exec Patterns

Prefer APIs that accept argv arrays. Validate allowed commands and allowed arguments separately. Normalize or reject unexpected characters. If shell usage is unavoidable, constrain the command to a fixed template and validate each inserted field against an allowlist.

## Review Checklist

- [ ] Commands use structured argv APIs instead of concatenated shell strings.
- [ ] Inputs are checked for separators, substitution, newlines, globs, and leading dashes.
- [ ] `--` is used where relevant to stop option injection.
- [ ] TypeScript, Python, and Bash examples all avoid `exec`, `os.system`, and `eval` patterns.
- [ ] Review covers tool output and other indirect attacker-controlled inputs.

# Secret Handling Playbook

## Core Practice

Secrets should flow through dedicated interfaces such as environment variables, secret managers, injected files with limited scope, or runtime handles. They should not flow through source code literals, screenshots, snapshots, shell history, or debug logs.

## Safe Wiring Patterns

Use names, paths, and contracts instead of values. Say `process.env.API_TOKEN`, `os.environ["API_TOKEN"]`, or `/run/secrets/api-token` rather than showing any token content.

Prefer the shortest path from secret source to secret consumer. Every extra copy creates another leak surface.

## Logging Patterns

Log secret state, not secret content. Safe logs include presence, source, age, rotation state, or validation outcome. Unsafe logs include full tokens, connection strings, authorization headers, signed URLs, or PEM blocks.

## Test And Documentation Patterns

Tests should use synthetic placeholders such as `<TOKEN_FROM_TEST_FIXTURE>` or `FAKE_EXAMPLE_ONLY`. Documentation should show where a value goes and how to inject it, not what a realistic value looks like.

Snapshots, screenshots, and copy-paste setup guides often become leak vectors. Review them as carefully as source code.

## TypeScript Examples

### Safe

```ts
export function readApiToken(): string {
  const token = process.env.API_TOKEN;

  if (!token) {
    throw new Error("API_TOKEN is required");
  }

  return token;
}
```

### Unsafe

```ts
export const API_TOKEN = "FAKE_TOKEN_EXAMPLE_ONLY";
```

Even fake literals teach the wrong integration pattern.

## Python Examples

### Safe

```python
import os


def get_db_password() -> str:
    password = os.environ["DB_PASSWORD"]
    return password
```

### Unsafe

```python
def debug_secret(password: str) -> None:
    print(f"db password={password}")
```

## Bash Examples

### Safe

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_TOKEN:-}" ]]; then
  printf 'API_TOKEN is missing\n' >&2
  exit 1
fi
```

### Unsafe

```bash
#!/usr/bin/env bash
set -euo pipefail

curl -H "Authorization: Bearer ${API_TOKEN}" "https://example.invalid"
```

Inline shell expansion can leak into process listings, traces, and logs.

## Cleanup Strategy For Exposed Secrets

When exposure occurs, first contain the artifact, then redact visible copies, then plan rotation with the system owner. Code cleanup alone is not enough if the secret may already have been observed. Preserve evidence for incident response without repeating the secret.

## Review Checklist

- [ ] Secrets enter code through approved interfaces instead of literals.
- [ ] Logs, tests, docs, and screenshots avoid revealing secret values.
- [ ] TypeScript, Python, and Bash examples model safe integration patterns.
- [ ] Redaction preserves context without disclosing the value.
- [ ] Cleanup guidance includes containment and rotation-oriented follow-up.

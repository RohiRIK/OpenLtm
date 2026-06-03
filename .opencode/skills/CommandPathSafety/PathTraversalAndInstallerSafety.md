# Path Traversal And Installer Safety

## Boundary Model

Every write, extract, copy, replace, or delete operation needs an explicit allowed root. Normalize the candidate path, resolve it against the root, and verify the final destination remains inside that root before touching the filesystem.

## Traversal And Zip-Slip Risks

Untrusted paths may contain `..`, absolute prefixes, mixed separators, symlinks, or archive metadata that escapes the intended directory. Zip-slip attacks use crafted archive entries such as `../../outside.txt` to overwrite files outside the extraction root.

## Installer Hardening Principles

Operate on a fixed list of managed targets. Avoid wildcard writes. Keep overwrite behavior intentional. Refuse to follow symlinks into unexpected locations. Validate both the source artifact and the final destination before moving files into place.

## TypeScript Examples

### Safe

```ts
import path from "node:path";

export function resolveWithinRoot(root: string, candidate: string): string {
  const resolved = path.resolve(root, candidate);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error("Path escapes allowed root");
  }

  return resolved;
}
```

### Unsafe

```ts
import path from "node:path";

export function installFile(root: string, candidate: string): string {
  return path.join(root, candidate);
}
```

`path.join` alone does not prove the final path stays inside the root.

## Python Examples

### Safe

```python
from pathlib import Path


def resolve_within_root(root: Path, candidate: str) -> Path:
    resolved = (root / candidate).resolve()
    if root.resolve() not in [resolved, *resolved.parents]:
        raise ValueError("Path escapes allowed root")
    return resolved
```

### Unsafe

```python
from pathlib import Path


def write_target(root: Path, candidate: str) -> Path:
    return root / candidate
```

## Bash Examples

### Safe

```bash
#!/usr/bin/env bash
set -euo pipefail

root_dir="$1"
candidate="$2"
target="$(python3 -c 'from pathlib import Path; import sys; root = Path(sys.argv[1]).resolve(); target = (root / sys.argv[2]).resolve(); print(target if root in [target, *target.parents] else "")' "$root_dir" "$candidate")"

[[ -n "$target" ]] || { printf 'Path escapes root\n' >&2; exit 1; }
```

### Unsafe

```bash
#!/usr/bin/env bash
set -euo pipefail

cp "$2" "$1/$3"
```

String concatenation does not enforce destination boundaries.

## Archive Extraction Checks

Validate every entry name before extraction. Reject absolute paths, parent traversal, device names, and symlink targets that resolve outside the root. Treat archive metadata as attacker-controlled input, not as trustworthy filesystem intent.

## Review Checklist

- [ ] Every filesystem operation resolves against an explicit allowed root.
- [ ] Final destinations are checked after normalization and resolution.
- [ ] Installer flows avoid wildcard writes and unexpected symlink traversal.
- [ ] Archive extraction defends against zip-slip and absolute-path escapes.
- [ ] TypeScript, Python, and Bash examples all validate final path boundaries.

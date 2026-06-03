# EnforcePathBoundaries

## Use When

Use when code writes files, extracts archives, installs assets, or accepts filenames that could escape an intended root.

## Procedure

1. Define the exact allowed root for the operation and list every candidate source of path input.
2. Normalize and resolve each candidate path against the allowed root before any filesystem action.
3. Reject traversal markers, absolute escapes, unexpected symlink targets, and archive entries that resolve outside the root.
4. Replace wildcard or implicit installer writes with an explicit managed target list.
5. Re-check the final destination after resolution and before overwrite, extraction, or replacement occurs.
6. Review TypeScript, Python, and Bash implementations for equivalent boundary gaps, then add adversarial tests.

## Done When

- [ ] Every destination is proven to remain inside an allowed root.
- [ ] Traversal, zip-slip, and symlink escapes are rejected.
- [ ] Installer operations act only on explicit managed targets.
- [ ] Cross-language path handling follows the same boundary rules.

## Escalate To @aegis When

- You suspect an active path traversal exploit or malicious archive.
- The boundary crosses user directories, system paths, or deployment artifacts.
- You need a wider audit of installer or extraction behavior.

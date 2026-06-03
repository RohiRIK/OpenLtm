# RemoveSecretExposure

## Use When

Use when code, docs, logs, tests, or examples contain a secret or secret-like value that must be contained and cleaned up.

## Procedure

1. Identify every artifact that contains the exposed value or a derived copy such as logs, snapshots, comments, or transcripts.
2. Contain further spread by removing the value from active prompts, outputs, and generated artifacts.
3. Replace the exposed value with a redacted marker that preserves provider or field context.
4. Update code, docs, tests, and shell snippets so future examples use interface-only references or obviously fake placeholders.
5. Document whether rotation or owner notification is required without repeating the secret in the note.
6. Re-review the cleaned artifacts for residual copies and screenshot risk, then add adversarial tests.

## Done When

- [ ] The exposed value is no longer present in maintained artifacts.
- [ ] Replacement text is clearly redacted and non-usable.
- [ ] Follow-up notes avoid reintroducing the secret.
- [ ] Future examples use safe placeholders or secret interfaces.

## Escalate To @aegis When

- The exposure may involve a real cloud credential, token, or private key.
- You need forensic guidance, scan coverage, or incident severity judgment.
- The leak spans commit history, artifacts, or multiple repositories.

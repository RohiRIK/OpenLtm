# DesignSecretSafeFlow

## Use When

Use when designing code, docs, tests, or automation that must access credentials without exposing them.

## Procedure

1. Identify the secret producer, the secret consumer, and every place the value could be copied or logged.
2. Choose a dedicated handoff mechanism such as environment injection, secret manager lookup, or restricted runtime file.
3. Replace any literal examples with interface-only references, placeholders, or redacted shapes.
4. Audit logs, error paths, tests, and docs to ensure they reveal state only, not secret content.
5. Minimize secret lifetime and duplication by passing the value directly to the consumer with the fewest intermediate hops.
6. Review the design for leak surfaces across TypeScript, Python, and Bash touchpoints, then add adversarial tests.

## Done When

- [ ] No design artifact embeds a secret literal.
- [ ] Secret flow uses an approved injection or retrieval path.
- [ ] Logs, docs, and tests show interface shape without value disclosure.
- [ ] Leak surfaces are identified and reduced.

## Escalate To @aegis When

- You suspect a real credential has already been exposed.
- You need repo-wide secret detection or incident-oriented review.
- The flow touches multiple systems and requires a formal security judgment.

# Cloud Credential Patterns

## Recognition Principles

Recognize provider credential formats so you can redact, quarantine, or avoid reproducing them. Do not copy live-looking values into code, docs, or tests. Use obviously fake placeholders that communicate format without resembling deployable credentials.

## AWS Patterns

Common AWS access key identifiers begin with prefixes such as `AKIA` or `ASIA`, followed by additional uppercase alphanumeric characters. Session tokens and secret access keys are separate values and should never be shown in full.

Use placeholders like `AKIA_FAKE_EXAMPLE_ONLY` or `ASIA_FAKE_SESSION_ONLY`. Keep them visibly synthetic with separators or words.

## GCP Patterns

Google API keys often begin with `AIza`. Service account credentials are usually JSON documents containing keys such as `type`, `project_id`, `client_email`, and `private_key`. Never reproduce a realistic private key block or full JSON blob from a live account.

Use placeholders like `AIza_FAKE_EXAMPLE_ONLY` and `"private_key": "<REDACTED-FAKE-KEY>"`.

## Azure Patterns

Azure leaks often appear inside connection strings or signed URLs. Watch for fields like `AccountKey=` in storage connection strings and query parameters such as `sig=` in SAS URLs. Redact the value while preserving enough shape to identify the credential class.

Use placeholders like `AccountKey=FAKE_EXAMPLE_ONLY` and `sig=FAKE_SIGNATURE_ONLY`.

## TypeScript Examples

### Safe

```ts
export function redactCloudSecret(value: string): string {
  if (value.startsWith("AKIA") || value.startsWith("ASIA")) {
    return "<AWS-KEY-REDACTED>";
  }

  if (value.startsWith("AIza")) {
    return "<GCP-API-KEY-REDACTED>";
  }

  return value.replace(/AccountKey=[^;]+/, "AccountKey=<REDACTED>");
}
```

### Unsafe

```ts
export const exampleConfig = {
  accessKeyId: "AKIAFAKEBUTTOOREAL1234",
  apiKey: "AIzaFakeButLooksReal1234567890",
};
```

Even fake examples must be obviously fake, not merely invalid.

## Python Examples

### Safe

```python
def mask_connection_string(text: str) -> str:
    return text.replace("AccountKey=FAKE_EXAMPLE_ONLY", "AccountKey=<REDACTED>")
```

### Unsafe

```python
SERVICE_ACCOUNT = {
    "type": "service_account",
    "private_key": "-----BEGIN PRIVATE KEY-----\npretend\n-----END PRIVATE KEY-----",
}
```

Avoid private-key shaped fixtures, even when they are fake.

## Bash Examples

### Safe

```bash
#!/usr/bin/env bash
set -euo pipefail

printf 'Using %s\n' 'AWS_ACCESS_KEY_ID=<REDACTED>'
```

### Unsafe

```bash
#!/usr/bin/env bash
set -euo pipefail

export AZURE_STORAGE_CONNECTION_STRING='DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=FAKE_EXAMPLE_ONLY'
```

Avoid shell examples that normalize inline secret storage, even with placeholders.

## Redaction Guidance

Preserve provider clues while removing the secret value. Examples: keep `AKIA...` as `AKIA<REDACTED>`, keep `sig=` as `sig=<REDACTED>`, and keep service account field names while replacing values. The goal is reviewability without leakage.

## Review Checklist

- [ ] AWS, GCP, and Azure credential shapes are recognized without reproducing realistic values.
- [ ] Examples use obviously fake placeholders, not plausible credentials.
- [ ] TypeScript, Python, and Bash examples all prefer redaction over inline storage.
- [ ] Service account JSON and signed URLs are described safely.
- [ ] Documentation preserves provider context while removing secret material.

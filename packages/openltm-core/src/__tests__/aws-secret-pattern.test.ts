/**
 * aws-secret-key pattern: AWS_SECRET_ACCESS_KEY=…, aws_secret_access_key = "…",
 * and slightly over-long (41-48) values are redacted; bare strings are not.
 * Shared fixture with hermes/openltm_hermes/test_secrets_scrubber.py (parity).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { scrubSecrets } from "../secretsScrubber.js";

const fx = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "aws-secret-cases.json"), "utf8")) as {
  redact: Record<string, string>;
  keep: Record<string, string>;
};
const VALUE = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE";

describe("aws-secret-key pattern", () => {
  it.each(Object.entries(fx.redact))("redacts %s", (_k, text) => {
    const r = scrubSecrets(text);
    expect(r.scrubbed).toContain("[REDACTED:aws-secret-key]");
    expect(r.scrubbed).not.toContain(VALUE);
  });
  it.each(Object.entries(fx.keep))("leaves %s alone (no aws-secret-key)", (_k, text) => {
    expect(scrubSecrets(text).redactions).not.toContain("aws-secret-key");
  });
});

describe("STS temporary credentials", () => {
  it("redacts ASIA key ids and the SessionToken in an STS block", () => {
    const r = scrubSecrets(fx.redact.sts_json);
    expect(r.scrubbed).not.toContain("ASIAIOSFODNN7EXAMPLE");
    expect(r.scrubbed).not.toContain("FwoGZXIvYXdzE");
    expect(r.redactions).toEqual(expect.arrayContaining(["aws-access-key", "aws-secret-key", "aws-session-token"]));
  });
});

describe("label normalization only decides; text is never rewritten", () => {
  it("keeps the original label and separator and replaces only the value", () => {
    expect(scrubSecrets(`Aws_Secret_Access_Key = "${VALUE}KEY"`).scrubbed).toBe('Aws_Secret_Access_Key = "[REDACTED:aws-secret-key]"');
  });
});

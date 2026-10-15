/**
 * aws-secret-key pattern: AWS_SECRET_ACCESS_KEY=…, aws_secret_access_key = "…",
 * and slightly over-long (41-48) values are redacted; bare strings are not.
 * Shared fixture with hermes/openltm_hermes/test_secrets_scrubber.py (parity).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { scrubSecrets } from "../secretsScrubber.js";

// Built at runtime so no key-shaped literal is committed (secret scanning).
const STS_KEY_ID = "AS" + "IA" + "Z".repeat(16);
const SESSION_TOKEN = "Q".repeat(120);
const PATH_40 = "Ab".repeat(20);
const raw = readFileSync(join(import.meta.dir, "fixtures", "aws-secret-cases.json"), "utf8")
  .replaceAll("{{STS_KEY_ID}}", STS_KEY_ID)
  .replaceAll("{{SESSION_TOKEN}}", SESSION_TOKEN)
  .replaceAll("{{PATH_40}}", PATH_40);
const { _note, ...fxAll } = JSON.parse(raw) as { _note?: string; redact: Record<string, string>; keep: Record<string, string> };
void _note;
const fx = fxAll as {
  redact: Record<string, string>;
  keep: Record<string, string>;
};
const VALUE = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE";

describe("aws-secret-key pattern", () => {
  it.each(Object.entries(fx.redact))("redacts %s", (_k, text) => {
    const r = scrubSecrets(text);
    expect(r.scrubbed).toMatch(/\[REDACTED:aws-(secret-key|session-token)\]/);
    expect(r.scrubbed).not.toContain(VALUE);
    expect(r.scrubbed).not.toContain(SESSION_TOKEN.slice(0, 40));
  });
  it.each(Object.entries(fx.keep))("leaves %s alone (no aws-secret-key)", (_k, text) => {
    expect(scrubSecrets(text).redactions).not.toContain("aws-secret-key");
  });
});

describe("STS temporary credentials", () => {
  it("redacts ASIA key ids and the SessionToken in an STS block", () => {
    const r = scrubSecrets(fx.redact.sts_json);
    expect(r.scrubbed).not.toContain(STS_KEY_ID);
    expect(r.scrubbed).not.toContain(SESSION_TOKEN.slice(0, 40));
    expect(r.redactions).toEqual(expect.arrayContaining(["aws-access-key", "aws-secret-key", "aws-session-token"]));
  });
});

describe("label normalization only decides; text is never rewritten", () => {
  it("keeps the original label and separator and replaces only the value", () => {
    expect(scrubSecrets(`Aws_Secret_Access_Key = "${VALUE}KEY"`).scrubbed).toBe('Aws_Secret_Access_Key = "[REDACTED:aws-secret-key]"');
  });
});

describe("byte preservation across every redact fixture", () => {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const MARKERS: Record<string, string> = {
    "[REDACTED:aws-secret-key]": "[0-9a-zA-Z/+]{40,48}",
    "[REDACTED:aws-access-key]": "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "[REDACTED:aws-session-token]": "[A-Za-z0-9/+=]{100,}",
  };
  it.each(Object.entries(fx.redact))("%s: only secret values change", (_k, text) => {
    const out = scrubSecrets(text).scrubbed;
    const parts = out.split(/(\[REDACTED:(?:aws-secret-key|aws-access-key|aws-session-token)\])/);
    const pattern = parts.map(p => MARKERS[p] ?? esc(p)).join("");
    expect(new RegExp(`^${pattern}$`).test(text)).toBe(true);
  });
});

describe("scrubber stays linear on 200k adversarial input", () => {
  const cases: Record<string, string> = {
    generic_key_run: "secret_key! ".repeat(16_667),
    markers_then_quote: "secret_key: [REDACTED:aws-secret-key] ".repeat(5_200) + "'",
    dash_label_run: ("AWS_" + "_".repeat(19) + "-".repeat(19)).repeat(4_762),
  };
  it.each(Object.entries(cases))("%s finishes under 500 ms", (_k, text) => {
    const t = performance.now();
    scrubSecrets(text);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("generic-api-key still redacts", () => {
  it.each([
    'api_key = "abcdefghijklmnopqrstuvwxyz123456"',
    "secret_key: 'abcdefghijklmnopqrstuvwxyz123456'",
    'access_token = "abcdefghijklmnopqrstuvwxyz123456"',
    "api_key = os.environ.get('X', 'abcdefghijklmnopqrstuvwxyz123456')", // getenv_sq
    `api_key = cfg['k'] or "abcdefghijklmnopqrstuvwxyz123456"`,
    "secret_key: 'a', backup: 'abcdefghijklmnopqrstuvwxyz123456'", // errs on the safe side
  ])("%s", (text) => {
    expect(scrubSecrets(text).redactions).toContain("generic-api-key");
    expect(scrubSecrets(text).scrubbed).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
});

describe("idempotence: scrub(scrub(x)) === scrub(x)", () => {
  it.each([...Object.entries(fx.redact), ...Object.entries(fx.keep)])("%s", (_k, text) => {
    const once = scrubSecrets(text).scrubbed;
    expect(scrubSecrets(once).scrubbed).toBe(once);
  });
});

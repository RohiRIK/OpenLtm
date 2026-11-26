/** pii.ts — personal-data masking on provider egress. */
import { afterEach, describe, expect, it } from "bun:test";
import { maskPii, luhnValid, introducesPiiPlaceholder, piiMode, maskPiiForProvider, maskPiiForAgent, _resetPiiModeForTesting } from "../pii.js";
import { scrubForEgress, scrubForProvider } from "../secretsScrubber.js";

const saved = process.env.LTM_MASK_PII;
afterEach(() => {
  if (saved === undefined) delete process.env.LTM_MASK_PII; else process.env.LTM_MASK_PII = saved;
  _resetPiiModeForTesting();
});

describe("maskPii", () => {
  it("masks emails, phones, cards, SSNs and IPs", () => {
    const r = maskPii("Mail dana@example.co.uk or call +1 415 555 0132 / (415) 555-0132; card 4111 1111 1111 1111; SSN 123-45-6789; host 10.20.30.40");
    expect(r.masked).toBe("Mail [EMAIL] or call [PHONE] / [PHONE]; card [CREDIT_CARD]; SSN [SSN]; host [IP_ADDRESS]");
    expect(r.found).toEqual(["email", "credit-card", "ssn", "phone", "ipv4"]);
  });

  it("leaves technical text alone", () => {
    const text = [
      "Released v2.21.1 on 2026-10-25 at 05:11:00, commit 8ee2a8e.",
      "llama-server listens on 127.0.0.1:8080 and 0.0.0.0:7331.",
      "Batch size 1500 requests per minute, 3,000 noise memories, MRR 0.55 → 0.78.",
      "UUID 3e50dc10-8462-40d8-b602-5a509c574d83, semver 1.2.3, port 7332.",
      "Order 1234567890123 failed Luhn so it stays.",
    ].join("\n");
    expect(maskPii(text)).toEqual({ masked: text, found: [] });
  });

  it("validates card numbers with Luhn", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("1234")).toBe(false);
  });

  it("spots placeholders a provider introduced", () => {
    expect(introducesPiiPlaceholder("Contact [EMAIL] for access", "Contact dana@example.com for access")).toBe(true);
    expect(introducesPiiPlaceholder("Contact [EMAIL] for access", "Contact [EMAIL] for access")).toBe(false);
  });
});

describe("modes", () => {
  it("defaults to providers: provider text masked, agent text as stored", () => {
    delete process.env.LTM_MASK_PII;
    _resetPiiModeForTesting();
    expect(piiMode()).toBe("providers");
    expect(maskPiiForProvider("ping dana@example.com")).toBe("ping [EMAIL]");
    expect(maskPiiForAgent("ping dana@example.com")).toBe("ping dana@example.com");
    expect(scrubForEgress("ping dana@example.com")).toBe("ping dana@example.com");
    expect(scrubForProvider("ping dana@example.com key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH")).not.toContain("dana@");
  });
  it("all masks agent egress too; off masks nothing", () => {
    process.env.LTM_MASK_PII = "all";
    _resetPiiModeForTesting();
    expect(scrubForEgress("ping dana@example.com")).toBe("ping [EMAIL]");
    process.env.LTM_MASK_PII = "off";
    _resetPiiModeForTesting();
    expect(scrubForProvider("ping dana@example.com")).toBe("ping dana@example.com");
  });
  it("ignores an unknown mode", () => {
    process.env.LTM_MASK_PII = "sometimes";
    _resetPiiModeForTesting();
    expect(piiMode()).toBe("providers");
  });
});

describe("Hermes twin", () => {
  it("_pii.py has the same pattern ids and placeholders, in order", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { PII_PATTERNS } = await import("../pii.js");
    const py = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "hermes", "openltm_hermes", "_pii.py"), "utf-8");
    const pyIds = [...py.matchAll(/PiiPattern\(\s*"([a-z0-9-]+)",\s*"(\[[A-Z_]+\])"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(pyIds).toEqual(PII_PATTERNS.map((p) => `${p.id} ${p.placeholder}`));
  });
});

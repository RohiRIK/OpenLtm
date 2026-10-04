import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
describe("ClawHub trusted publishing contract", () => {
  test("secretless ClawHub job requires workflow_dispatch, retaining npm dependency", () => {
    const workflow = read(".github/workflows/publish.yml");
    const job = workflow.split("\n  clawhub:\n")[1];
    expect(job).toBeDefined();
    expect(job.match(/^    if:.*$/m)?.[0]).toBe("    if: github.event_name == 'workflow_dispatch'");
    expect(job).toContain("needs: publish");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("workflow_dispatch:");
  });
  test("artifact build and workspace rewrite precede upload, with restoration and no auth bypass", () => {
    const script = read("scripts/clawhub-publish-if-needed.sh");
    const publish = script.indexOf("$CLAWHUB package publish");
    expect(publish).toBeGreaterThan(script.indexOf('bun run build'));
    expect(publish).toBeGreaterThan(script.indexOf('resolve-workspace-deps.ts rewrite'));
    expect(script).toContain('resolve-workspace-deps.ts restore');
    expect(script).not.toContain("--manual-override-reason");
  });
});

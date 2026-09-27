#!/usr/bin/env bun
/**
 * monthly-maintenance.ts — one-command repo health check.
 *
 * Runs the recurring static checks and security scans we want on a monthly
 * cadence, then prints a single pass/fail/skip summary. Optional scanners that
 * are not installed are reported as skipped, never as passed.
 *
 * Usage:
 *   bun run check:monthly
 *   bun run check:monthly --json     # machine-readable summary on stdout
 */
import { spawnSync } from "bun";

interface Step {
  label: string;
  command: string[];
  optional?: boolean;
  cwd?: string;
  /** Extra bash precondition, e.g. a Python module that must be importable. */
  requires?: string;
}

type Status = "pass" | "fail" | "skipped";

interface StepResult {
  label: string;
  status: Status;
  exitCode: number | null;
  detail?: string;
}

interface Skipped {
  label: string;
  reason: string;
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const quiet = asJson || argv.includes("--quiet");

const steps: Step[] = [
  { label: "tests", command: ["bun", "test"] },
  { label: "typecheck", command: ["bun", "run", "typecheck"] },
  { label: "verify-version", command: ["bun", "run", "verify-version"] },
  { label: "dependency-audit", command: ["bun", "audit"] },
  { label: "catalog-entry", command: ["bun", "run", "catalog:check"] },
  { label: "trivy", command: ["trivy", "fs", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "."], optional: true },
  { label: "trufflehog", command: ["trufflehog", "filesystem", "--exclude-paths", ".trufflehogignore", "."], optional: true },
  {
    label: "hermes-pytest",
    command: ["python3", "-m", "pytest", "-q"],
    cwd: "/tmp/openltm-plugin-test",
    optional: true,
    requires: "python3 -m pytest --version",
  },
  {
    // Runs with stdlib only, so extraction policy is verified even on machines
    // without pytest. Requires no Hermes runtime.
    label: "hermes-unittest",
    command: ["python3", "-m", "unittest", "test_auto_capture"],
    cwd: "/tmp/openltm-plugin-test",
    optional: true,
  },
];

function hasCommand(command: string): boolean {
  return spawnSync(["bash", "-lc", `command -v ${command}`], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function hasRequirement(requirement: string): boolean {
  return spawnSync(["bash", "-lc", requirement], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function header(label: string): void {
  if (!quiet) process.stdout.write(`\n=== ${label} ===\n`);
}

const results: StepResult[] = [];
const skipped: Skipped[] = [];

for (const step of steps) {
  const executable = step.command[0]!;

  if (step.requires && !hasRequirement(step.requires)) {
    skipped.push({ label: step.label, reason: `${step.requires} unavailable` });
    continue;
  }
  if (!hasCommand(executable)) {
    const reason = `${executable} not installed`;
    if (step.optional) {
      skipped.push({ label: step.label, reason });
      continue;
    }
    results.push({ label: step.label, status: "fail", exitCode: null, detail: reason });
    continue;
  }

  // Hermes tests must run from a scratch copy, never the live plugin dir/DB.
  if (step.label === "hermes-pytest" || step.label === "hermes-unittest") {
    spawnSync(["bash", "-lc", "rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test"], {
      stdout: quiet ? "ignore" : "inherit",
      stderr: "inherit",
    });
  }

  header(step.label);
  const run = spawnSync(step.command, {
    cwd: step.cwd,
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
    env: process.env,
  });

  if (run.exitCode === 0) {
    results.push({ label: step.label, status: "pass", exitCode: 0 });
  } else if (step.optional) {
    results.push({ label: step.label, status: "fail", exitCode: run.exitCode ?? null, detail: "optional check failed" });
  } else {
    results.push({ label: step.label, status: "fail", exitCode: run.exitCode ?? null, detail: "required check failed" });
  }
}

const required = results.filter((r) => r.status !== "pass");
const optionalFailures = results.filter((r) => r.status === "fail" && r.detail === "optional check failed");
const ok = required.length === 0;

const summary = {
  ok,
  passed: results.filter((r) => r.status === "pass").map((r) => r.label),
  failed: required.map((r) => ({ label: r.label, detail: r.detail, exitCode: r.exitCode })),
  optionalFailed: optionalFailures.map((r) => r.label),
  skipped: skipped.map((s) => ({ label: s.label, reason: s.reason })),
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write("\n=== summary ===\n");
  for (const label of summary.passed) process.stdout.write(`  PASS  ${label}\n`);
  for (const item of summary.failed) process.stdout.write(`  FAIL  ${item.label} — ${item.detail}\n`);
  for (const label of summary.optionalFailed) process.stdout.write(`  WARN  ${label} — optional check failed\n`);
  for (const item of summary.skipped) process.stdout.write(`  SKIP  ${item.label} — ${item.reason}\n`);
  process.stdout.write(`\n${ok ? "maintenance: OK" : "maintenance: FAILED"}\n`);
}

process.exit(ok ? 0 : 1);

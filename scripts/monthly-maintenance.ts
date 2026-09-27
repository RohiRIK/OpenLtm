#!/usr/bin/env bun
/**
 * monthly-maintenance.ts — one-command repo health check.
 *
 * Runs the recurring static checks and security scans we want on a monthly
 * cadence, while degrading cleanly when optional scanners are not installed.
 */
import { spawnSync } from "bun";

interface Step {
  label: string;
  command: string[];
  optional?: boolean;
  cwd?: string;
}

const steps: Step[] = [
  { label: "tests", command: ["bun", "test"] },
  { label: "typecheck", command: ["bun", "run", "typecheck"] },
  { label: "verify-version", command: ["bun", "run", "verify-version"] },
  { label: "dependency-audit", command: ["bun", "audit"] },
  { label: "trivy", command: ["trivy", "fs", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "."], optional: true },
  { label: "trufflehog", command: ["trufflehog", "filesystem", "--exclude-paths", ".trufflehogignore", "."], optional: true },
  {
    label: "hermes-pytest",
    command: ["python3", "-m", "pytest", "-q"],
    cwd: "/tmp/openltm-plugin-test",
    optional: true,
  },
];

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(["bash", "-lc", `command -v ${command}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

function hasPythonPytest(): boolean {
  const result = spawnSync(["python3", "-m", "pytest", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

function printHeader(label: string): void {
  process.stdout.write(`\n=== ${label} ===\n`);
}

let failed = false;

for (const step of steps) {
  const executable = step.command[0]!;
  if (step.label === "hermes-pytest" && !hasPythonPytest()) {
    printHeader(step.label);
    process.stdout.write("SKIPPED: python3 -m pytest not available\n");
    continue;
  }

  if (step.optional && !isCommandAvailable(executable)) {
    printHeader(step.label);
    process.stdout.write(`SKIPPED: ${executable} not installed\n`);
    continue;
  }

  if (step.label === "hermes-pytest") {
    spawnSync(["bash", "-lc", "rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test"], {
      stdout: "inherit",
      stderr: "inherit",
    });
  }

  printHeader(step.label);
  const result = spawnSync(step.command, {
    cwd: step.cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  if (result.exitCode !== 0) {
    if (step.optional) {
      process.stdout.write(`OPTIONAL CHECK FAILED: ${step.label} (exit ${result.exitCode})\n`);
    } else {
      failed = true;
      process.stdout.write(`FAILED: ${step.label} (exit ${result.exitCode})\n`);
    }
  }
}

process.exit(failed ? 1 : 0);

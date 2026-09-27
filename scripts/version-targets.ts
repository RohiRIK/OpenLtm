/**
 * version-targets.ts — the single source of truth for version-bearing files.
 *
 * Both `bump-version.ts` (writes) and `verify-version-sync.ts` (checks) import
 * this list, so the two can never drift apart and silently skip a file again.
 * Adding a version reference here makes both scripts pick it up.
 */

export interface VersionPatch {
  /** Matches one version occurrence. Must be global. */
  pattern: RegExp;
  /** Produces the replacement text for one match. */
  replace: (match: string, newVersion: string) => string;
  /** Pulls the current version value out of a match, for verification. */
  extract: (match: string) => string;
  /** How many occurrences this patch should find. Default 1. */
  expectedCount?: number;
  /** Human-readable description, used in output and error messages. */
  describe: string;
}

export interface VersionTarget {
  /** Repo-relative path. */
  file: string;
  label: string;
  /** Every occurrence in the file that must carry the version. */
  patches: VersionPatch[];
  /** When true, a missing file is a failure rather than a skip. */
  required?: boolean;
}

/** Last quoted string in a match — for `"key": "value"` shapes. */
function lastQuoted(match: string): string {
  const all = match.match(/"[^"]*"/g);
  return all && all.length > 0 ? all[all.length - 1].replace(/"/g, "") : match;
}

const versionJson = (
  describe: string,
): VersionPatch => ({
  pattern: /"version"\s*:\s*"[^"]+"/g,
  replace: (match, newVersion) => match.replace(/"[^"]+"\s*$/, `"${newVersion}"`),
  extract: lastQuoted,
  describe,
});

export const VERSION_TARGETS: VersionTarget[] = [
  {
    file: "package.json",
    label: "package.json",
    required: true,
    patches: [versionJson("version field")],
  },
  {
    file: ".claude-plugin/plugin.json",
    label: ".claude-plugin/plugin.json",
    required: true,
    patches: [versionJson("version field")],
  },
  {
    file: ".claude-plugin/marketplace.json",
    label: ".claude-plugin/marketplace.json",
    required: true,
    // The marketplace carries the version twice — metadata.version and
    // plugins[0].version — via the same JSON shape, so one global patch with an
    // occurrence count covers both and cannot half-apply.
    patches: [{ ...versionJson("version fields"), expectedCount: 2 }],
  },
  {
    file: "README.md",
    label: "README.md badge",
    required: true,
    patches: [
      {
        pattern: /version-[0-9]+\.[0-9]+\.[0-9]+-blue/g,
        replace: (match, newVersion) => `version-${newVersion}-blue`,
        extract: (match) => /version-([0-9]+\.[0-9]+\.[0-9]+)-blue/.exec(match)?.[1] ?? match,
        describe: "version badge",
      },
    ],
  },
  {
    file: "docs/03-architecture.md",
    label: "docs/03-architecture.md",
    patches: [
      {
        pattern: /against plugin v[0-9]+\.[0-9]+\.[0-9]+/g,
        replace: (match, newVersion) => `against plugin v${newVersion}`,
        extract: (match) => /against plugin v([0-9]+\.[0-9]+\.[0-9]+)/.exec(match)?.[1] ?? match,
        describe: "header version reference",
      },
    ],
  },
  {
    file: "packages/openltm-core/package.json",
    label: "packages/openltm-core",
    required: true,
    patches: [versionJson("version field")],
  },
  {
    file: "packages/adapter-pi/package.json",
    label: "packages/adapter-pi",
    required: true,
    patches: [versionJson("version field")],
  },
  {
    file: "packages/adapter-opencode/package.json",
    label: "packages/adapter-opencode",
    required: true,
    patches: [versionJson("version field")],
  },
  {
    file: "hermes/openltm_hermes/plugin.yaml",
    label: "hermes plugin.yaml",
    patches: [
      {
        // YAML style: `version: "2.14.1"` or `version: 2.14.1`. Only the
        // `version` key is touched — the plugin `name` must be left alone.
        pattern: /^version:\s*"?[0-9]+\.[0-9]+\.[0-9]+"?/gm,
        replace: (match, newVersion) => `version: "${newVersion}"`,
        extract: (match) => /version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/.exec(match)?.[1] ?? match,
        describe: "version field",
      },
    ],
  },
];

/** Count total version occurrences this list expects to manage. */
export const VERSION_OCCURRENCE_COUNT = VERSION_TARGETS.reduce(
  (sum, target) =>
    sum + target.patches.reduce((n, patch) => n + (patch.expectedCount ?? 1), 0),
  0,
);

# Installation

OpenLTM installs in three ways. Pick one. All of them produce the same thing: a local SQLite database the plugin owns, wired to your agent's hooks.

> Just want the fastest path? See [Quickstart](00-quickstart.md). Hitting an install error? See [Troubleshooting](09-troubleshooting.md).

---

## Requirements

| | |
|---|---|
| **Runtime** | [Bun](https://bun.sh) (the plugin detects it automatically; `npm`/`node` are not used at runtime) |
| **Host** | Claude Code, OpenCode, Pi, OpenClaw, or Hermes |
| **OS** | macOS, Linux, or WSL |
| **System SQLite** (optional) | Homebrew-installed sqlite on macOS (`brew install sqlite`) or a system `libsqlite3.so` on Linux — required for sqlite-vec vector recall and Honker queue/cron/pub-sub. Without it, the plugin runs on Bun's built-in SQLite (FTS5, JS-cosine) with no feature loss, just software fallbacks. |

The database lives **outside** the plugin directory — at `~/.claude/plugins/data/OpenLtm-openltm/openltm.db` — so it survives every plugin update. OpenLTM's other files sit next to it in the same data dir: the project registry and per-project context in `projects/`, and `config.json`.

### Upgrading from an older install

Older versions kept the project registry and context files in `~/.claude/projects/` (Claude Code's own transcript folder) and the config in `~/.claude/config.json`. Nothing to do by hand: on first use the registry and context files are **copied** into the data dir, and the legacy files are left exactly as they were. An existing `~/.claude/config.json` keeps working until a `config.json` exists in the data dir. Project names that already hold memories are kept. Details and overrides (`LTM_DATA_DIR`, `LTM_CONFIG_PATH`): [Configuration → File locations](04-configuration.md#file-locations).

---

## Option A — Marketplace (recommended)

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install openltm
```

Restart Claude Code. Seven Claude Code hooks auto-wire, seven commands load, four skills and two agents activate, and the database creates or migrates itself. The git post-commit hook (for git-learn) is installed but only activated when you turn on `ltm.gitLearnEnabled`.

To update later:

```bash
claude plugin update openltm
```

The marketplace detects new versions from `.claude-plugin/plugin.json` — not from GitHub releases.

---

## Option B — bunx (no clone)

Run the core installer directly; it auto-detects the host:

```bash
bunx @rohirik/openltm-core                     # auto-detect Claude Code / OpenCode
bunx @rohirik/openltm-core --pi                # experimental Pi adapter
bunx @rohirik/openltm-core --dry-run --claude  # preview without writing anything
```

`--dry-run` prints exactly what would be installed and changes nothing on disk.

---

## Option C — Dev / git clone

For hacking on OpenLTM itself:

```bash
git clone https://github.com/RohiRIK/OpenLtm ~/Projects/OpenLtm
cd ~/Projects/OpenLtm
bun install
bash install.sh
```

See [Contributing](../CONTRIBUTING.md) for the development workflow, test commands, and version-bump rules.

---

## Other hosts

OpenLTM is one core (`@rohirik/openltm-core`) with thin per-host adapters:

| Host | Adapter | Status |
|------|---------|--------|
| Claude Code | built in | stable |
| OpenCode | `@rohirik/opencode-ltm` | stable |
| Pi | `@rohirik/pi-ltm` | experimental |
| OpenClaw | `@rohirik/openclaw-ltm` | `openclaw plugins install clawhub:@rohirik/openclaw-ltm --accept-capabilities` (from npm: `@rohirik/openclaw-ltm --force --accept-capabilities`) — see [its README](../packages/adapter-openclaw/README.md) |
| Hermes | native Python plugin | `hermes plugins install openltm` — see [Hermes Integration](10-hermes-plugin.md) |

Every channel and where it is published: [External Distribution](11-publishing.md).

---

## Verify

```
/openltm:health                 # versions, runtime, DB, hooks, decay
/openltm:memory recall test     # returns results, or "no results" on a fresh install
```

Start a new session — context should be injected at the top. If it isn't, run `/openltm:health` and see [Troubleshooting](09-troubleshooting.md).

---

## See also

- [Quickstart](00-quickstart.md) — five-minute first run
- [Configuration](04-configuration.md) — every setting and its default
- [Troubleshooting](09-troubleshooting.md) — fix common install issues

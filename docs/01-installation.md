# Installation

OpenLTM installs in three ways. Pick one. All of them produce the same thing: a local SQLite database the plugin owns, wired to your agent's hooks.

> Just want the fastest path? See [Quickstart](00-quickstart.md). Hitting an install error? See [Troubleshooting](09-troubleshooting.md).

---

## Requirements

| | |
|---|---|
| **Runtime** | [Bun](https://bun.sh) (the plugin detects it automatically; `npm`/`node` are not used at runtime) |
| **Host** | Claude Code, OpenCode, or Pi |
| **OS** | macOS, Linux, or WSL |

The database lives **outside** the plugin directory — at `~/.claude/plugins/data/OpenLtm-openltm/openltm.db` — so it survives every plugin update.

---

## Option A — Marketplace (recommended)

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install openltm
```

Restart Claude Code. Four Claude Code hooks plus one git post-commit hook auto-wire, four commands load, five skills activate, and the database creates or migrates itself.

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

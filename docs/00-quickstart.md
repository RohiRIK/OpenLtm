# Quickstart

From zero to a memory that survives your next session — in five minutes.

> New to OpenLTM? This is the fast path. For every install option and platform note, see [Installation](01-installation.md). For the mental model, see [How It Works](02-how-it-works.md).

---

## 1. Install

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install openltm
```

Restart Claude Code. On first launch the hooks auto-wire and `openltm.db` is created (or your existing database migrates) under `~/.claude/plugins/data/OpenLtm-openltm/`.

---

## 2. Confirm it's alive

```
/openltm:health
```

You should see plugin versions, Bun detection, DB connectivity, and hook registration all green. If anything is red, jump to [Troubleshooting](09-troubleshooting.md).

---

## 3. Seed the project

Run once per repository so OpenLTM knows what you're working on:

```
/openltm:project init
```

It asks for the current goal, stores it, and injects it at the top of every future session for this project.

---

## 4. Teach it something

```
/openltm:memory learn "we use Bun, never npm" --category preference --importance 5
```

`--importance 5` makes it permanent — injected every session. Everything below 5 ages out naturally as it goes unused.

---

## 5. Get it back

```
/openltm:memory recall "package manager"
```

Recall runs FTS5 first, then falls back to semantic vector search — so *"package manager"* finds the Bun memory even though you never wrote those words.

---

## What happens automatically

You will never have to call `learn` by hand again unless you want to. The hooks do the work:

| When | What fires |
|------|-----------|
| Session start | Top memories + project context injected above your first message |
| Session end | The session is reviewed; durable patterns are extracted and proposed |
| Before compaction | Context is summarized and preserved |
| After a git commit | The diff is mined for engineering patterns (if `gitLearn` is enabled) |

Review what the session proposed:

```
/openltm:memory propose list
```

---

## Next steps

- [Installation](01-installation.md) — bunx, dev clone, OpenCode/Pi adapters
- [Commands](05-commands.md) — every command and flag
- [Configuration](04-configuration.md) — tune decay, injection, and embeddings
- [How It Works](02-how-it-works.md) — the 30-second tour of the engine

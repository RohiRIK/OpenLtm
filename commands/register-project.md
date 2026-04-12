---
description: "Register or rename a project in the LTM registry."
disable-model-invocation: true
---

# /ltm:register-project — Register or Rename a Project

Maps the current directory (or any path) to a friendly name in the context registry.

## Usage

```
/ltm:register-project                              # register cwd, ask for name
/ltm:register-project my-project-name             # register cwd as given name
/ltm:register-project /abs/path my-project-name   # register specific path
```

## Instructions for Claude

### Step 1 — Determine path and name

- **Path:** use argument if given, otherwise use current `cwd`
- **Name:** use argument if given; otherwise ask:
  > "What name should I use for this project? (suggested: `<folder-name>`)"
  > Press enter to accept the suggestion.

### Step 2 — Validate name

Name must be: lowercase, alphanumeric + hyphens only, 3–40 chars.
- Valid: `device-inventory`, `ai-soc`, `claude-config`
- Invalid: `My Project`, `app.v2`, `x` — ask user to fix before continuing

### Step 3 — Read registry

Read `~/.claude/projects/registry.json`. If missing, treat as `{}`.

### Step 4 — Check for conflicts

- If `<name>` is already used by a **different path**: warn the user and ask to confirm override or choose a new name
- If `<path>` is already registered with a **different name**: ask "This path is already registered as `<old-name>`. Rename to `<new-name>`? (yes/no)"

### Step 5 — Write registry

Add or update: `{ "<path>": "<name>" }` → write back to `registry.json`.

### Step 6 — Create context folder

Create `~/.claude/projects/<name>/` if it doesn't exist.

### Step 7 — Offer migration (if old slug folder exists)

Check if `~/.claude/projects/<slug>/` contains context files (where slug = path with `/` and `.` replaced by `-`).
If yes:
> "Found existing context in `<slug>/`. Copy it to `<name>/`? (yes/no)"

If yes: copy `context-*.md` files. Do NOT delete the old folder.

### Step 8 — Confirm

> Registered `<path>` as **<name>**.
> Context files → `~/.claude/projects/<name>/`
> Run `/ltm:analyze-context` to verify.

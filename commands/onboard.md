---
description: "Run the LTM onboarding wizard to set up memory for a new project"
allowed-tools: ["Bash"]
---

Runs the interactive terminal onboarding wizard for Claude LTM.

## When to use

Run this when starting a new project to seed your goal, preferences, and first memories into LTM.

## Usage

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/src/onboard.ts"
```

This launches a 5-step guided setup:
1. Project name
2. Current goal (1-2 sentences)
3. First memory (a rule or preference)
4. Confirmation
5. Save to LTM database

## What it saves

- A `goal` context item for the project
- An initial memory with category `preference` and importance 4

# Migration Guide

## Upgrading from old `~/.claude/memory/` setup

If you previously used LTM via the git-clone dev setup, your database is already at `~/.claude/memory/openltm.db`. No manual steps needed.

### Switching to marketplace install

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install ltm
```

On first install, `install-wiring.ts` automatically:
1. Detects `CLAUDE_PLUGIN_DATA` is set
2. Checks if `$CLAUDE_PLUGIN_DATA/openltm.db` exists
3. If not — copies `~/.claude/memory/openltm.db` across
4. All your memories are preserved ✅

```
  ~/.claude/memory/openltm.db  ──copy──▶  $CLAUDE_PLUGIN_DATA/openltm.db
         (old location)                   (new permanent home)
```

### What to clean up (optional)

After switching to marketplace install, the old files in `~/.claude/memory/` are no longer used by the plugin. You can clean them up:

```bash
# Old JS modules (replaced by MCP tools)
rm ~/.claude/memory/db.js
rm ~/.claude/memory/context.js
rm ~/.claude/memory/shared-db.js
rm ~/.claude/memory/secretsScrubber.js

# Keep openltm.db until you confirm the marketplace install is working
# Then you can remove it or keep as backup
```

### Old commands in `~/.claude/commands/`

Your old commands (`/recall`, `/learn` etc.) still work — they read from `~/.claude/commands/`. The plugin provides `/openltm:recall`, `/openltm:learn` etc. as separate commands.

You can remove the old ones once you're comfortable with the plugin versions:

```bash
rm ~/.claude/commands/recall.md
rm ~/.claude/commands/learn.md
# etc.
```

## Plugin update

```bash
claude plugin update ltm
```

Your db at `$CLAUDE_PLUGIN_DATA/openltm.db` is **never touched** during updates. Only the plugin code cache is replaced. Zero data loss.

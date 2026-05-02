/**
 * onboard.ts — Interactive terminal wizard to seed LTM for a new project.
 * Run standalone: bun src/onboard.ts
 * Not bundled with mcp-server.
 */
import * as p from "@clack/prompts";
import { getDb } from "./shared-db.js";

async function main(): Promise<void> {
  p.intro("Welcome to Claude LTM — Long-Term Memory for Claude Code");

  // Step 1: Project name
  const projectName = await p.text({
    message: "What is this project called?",
    placeholder: "my-project",
    validate: (v) => (!v || v.trim().length === 0 ? "Project name required" : undefined),
  });
  if (p.isCancel(projectName)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 2: Current goal
  const goal = await p.text({
    message: "What is the current goal for this project? (1-2 sentences)",
    placeholder: "Build a REST API for user authentication",
  });
  if (p.isCancel(goal)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 3: First memory (preference / rule)
  const firstMemory = await p.text({
    message: "What is one thing you always want Claude to remember about this project?",
    placeholder: "We use Bun, not Node. Never suggest npm.",
  });
  if (p.isCancel(firstMemory)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 4: Confirm
  const confirmed = await p.confirm({
    message: `Save this setup for project "${projectName as string}"?`,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 5: Persist to DB
  const db = getDb();

  // Upsert goal context_item (replace existing goal for this project)
  db.run(
    `INSERT INTO context_items (project_name, type, content, permanent, created_at)
     VALUES (?, 'goal', ?, 0, datetime('now'))
     ON CONFLICT DO NOTHING`,
    [projectName as string, (goal as string).trim()],
  );

  // If goal row already exists, update it
  db.run(
    `UPDATE context_items
     SET content = ?
     WHERE project_name = ? AND type = 'goal'`,
    [(goal as string).trim(), projectName as string],
  );

  // Insert first memory if non-empty
  const memoryContent = (firstMemory as string).trim();
  if (memoryContent.length > 0) {
    db.run(
      `INSERT INTO memories (content, category, importance, project_scope, created_at, last_confirmed_at, last_used_at)
       VALUES (?, 'preference', 4, ?, datetime('now'), datetime('now'), datetime('now'))`,
      [memoryContent, projectName as string],
    );
  }

  p.outro("Setup complete! Claude will remember your project context from next session.");
}

main().catch(console.error);

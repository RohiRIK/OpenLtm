/**
 * dao/index.ts — Single import surface for the DAO layer.
 * Hooks and MCP tools import from here, never from db.ts directly for context_items.
 * Memories are still accessed via src/db.ts (learn, recall, relate, forget).
 */
export * from "./types.js";
export * from "./contextItems.js";

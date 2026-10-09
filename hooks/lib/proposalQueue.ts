import { writeFileSync, existsSync, mkdirSync } from "fs"
import { dirname } from "path"

export interface MemoryProposal {
  content: string
  category: string
  importance: number
  source: string
}

/** `project` is the session's project — accepted proposals are scoped to it. */
export function writeProposals(proposalsPath: string, proposals: MemoryProposal[], project?: string): void {
  const dir = dirname(proposalsPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(proposalsPath, JSON.stringify({ proposals, generatedAt: Date.now(), ...(project ? { project } : {}) }, null, 2), "utf8")
}

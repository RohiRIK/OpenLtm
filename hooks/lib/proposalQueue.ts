import { writeFileSync, existsSync, mkdirSync } from "fs"
import { dirname } from "path"

export interface MemoryProposal {
  content: string
  category: string
  importance: number
  source: string
}

export function writeProposals(proposalsPath: string, proposals: MemoryProposal[]): void {
  const dir = dirname(proposalsPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(proposalsPath, JSON.stringify({ proposals, generatedAt: Date.now() }, null, 2), "utf8")
}

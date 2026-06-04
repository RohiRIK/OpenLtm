export const NODE_COLORS: Record<string, string> = {
  project: "#38bdf8",
  goal: "#fbbf24",
  decision: "#fb923c",
  gotcha: "#f87171",
  progress: "#60a5fa",
  preference: "#4ade80",
  pattern: "#a78bfa",
  workflow: "#fb923c",
  constraint: "#facc15",
};

export function nodeColor(category: string): string {
  return NODE_COLORS[category] ?? "#9ca3af";
}

export function nodeRadius(importance: number, isProject?: boolean, isContext?: boolean): number {
  if (isProject) return 8;
  if (isContext) return 3;
  return 3 + (importance - 1) * 1.5;
}

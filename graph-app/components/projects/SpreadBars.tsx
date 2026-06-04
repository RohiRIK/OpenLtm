import type { ProjectHealthScore } from "@/lib/types";

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

/* Per-project health spread — a column-bar chart giving an at-a-glance read on
   how scores are distributed across every project. */
export default function SpreadBars({
  projects,
  height = 40,
}: {
  projects: ProjectHealthScore[];
  height?: number;
}) {
  const sorted = [...projects].sort((a, b) => b.score - a.score);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {sorted.map((p) => (
        <div
          key={p.project}
          className="group relative flex-1 self-stretch overflow-hidden rounded-[1px] bg-[var(--bg-tertiary)]"
          title={`${shortName(p.project)}: ${p.score}`}
        >
          <div
            className="absolute bottom-0 w-full bg-[var(--accent)] transition-opacity group-hover:opacity-100"
            style={{ height: `${Math.max(5, p.score)}%`, opacity: 0.3 + (p.score / 100) * 0.6 }}
          />
        </div>
      ))}
    </div>
  );
}

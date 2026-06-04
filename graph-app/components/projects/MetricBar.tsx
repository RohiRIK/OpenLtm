import { cn } from "@/lib/utils";

export type Metric = {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
};

/* Command-center KPI strip — one surface, hairline dividers, tabular numbers.
   `dense` packs more metrics with tighter padding + smaller type. */
export default function MetricBar({
  metrics,
  dense = false,
  className,
}: {
  metrics: Metric[];
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid divide-x divide-border rounded-md border border-border bg-card",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}
    >
      {metrics.map((m) => (
        <div
          key={m.label}
          className={cn("flex flex-col", dense ? "gap-1 px-4 py-3" : "gap-2 px-5 py-5")}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {m.label}
          </span>
          <span
            className={cn(
              "font-light tabular-nums leading-none tracking-[-0.02em]",
              dense ? "text-2xl" : "text-[2.4rem]",
              m.accent ? "text-[var(--accent)]" : "text-foreground",
            )}
          >
            {m.value}
          </span>
          {m.sublabel && (
            <span className={cn("text-muted-foreground", dense ? "text-[11px]" : "text-xs")}>
              {m.sublabel}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

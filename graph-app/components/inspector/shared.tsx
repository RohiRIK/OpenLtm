import { categoryBadgeColors } from "@/lib/categoryColors";

export function ConfidenceBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const clamped = Math.max(0, Math.min(1, v));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div className="bg-primary h-full rounded-full" style={{ width: `${clamped * 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

export function TagChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/5 border border-white/10 text-foreground text-xs px-2 py-0.5 rounded-full">
      <span className="text-muted-foreground">#</span>
      {name}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  // We use the existing categoryBadgeColors mapping but can gradually replace it with standard tokens
  const colors = categoryBadgeColors[category] ?? "bg-white/5 text-muted-foreground border-white/10";
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest font-semibold rounded border ${colors}`}>
      {category}
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {children}
    </div>
  );
}

export function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-muted-foreground text-right">{children}</span>
    </div>
  );
}

export function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return <span title={date.toLocaleString()}>today</span>;
  if (days === 1) return <span title={date.toLocaleString()}>yesterday</span>;
  if (days < 30) return <span title={date.toLocaleString()}>{days}d ago</span>;
  if (days < 365) return <span title={date.toLocaleString()}>{Math.floor(days / 30)}mo ago</span>;
  return <span title={date.toLocaleString()}>{Math.floor(days / 365)}y ago</span>;
}

import { Suspense } from "react";
import GraphView from "@/components/GraphView";

export default function GraphPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading graph…</div>}>
      <GraphView />
    </Suspense>
  );
}

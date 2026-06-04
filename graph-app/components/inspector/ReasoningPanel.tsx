import { ReasoningResult } from "@/lib/types";
import { SectionLabel } from "./shared";

export function ReasoningPanel({ result, onNodeClick }: {
  result: ReasoningResult;
  onNodeClick?: (id: number) => void;
}) {
  if (result.chain.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-4">No connected memories found.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Chain */}
      <div>
        <SectionLabel>Reasoning Chain ({result.chain.length} nodes)</SectionLabel>
        <div className="space-y-1">
          {result.chain.map((n, i) => (
            <button
              key={n.id}
              onClick={() => onNodeClick?.(n.id)}
              className="w-full flex items-center gap-2 text-xs bg-yellow-900/10 border border-yellow-800/30 rounded px-2.5 py-1.5 hover:border-yellow-700/50 hover:bg-yellow-900/20 transition-colors cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
            >
              <span className="text-yellow-600 font-mono shrink-0 text-xs">{i + 1}</span>
              <span className="text-foreground truncate flex-1">{n.content.substring(0, 60)}</span>
              <span className="text-muted-foreground font-mono shrink-0">#{n.id}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Conflicts */}
      {result.conflicts.length > 0 && (
        <div>
          <SectionLabel>Conflicts ({result.conflicts.length})</SectionLabel>
          <div className="space-y-1">
            {result.conflicts.map((p) => (
              <div key={`${p.a.id}-${p.b.id}-${p.type}`} className="text-xs bg-red-900/10 border border-red-800/30 rounded px-2.5 py-1.5">
                <span className="text-red-400">↔</span>
                <span className="text-muted-foreground ml-1 italic">{p.type}</span>
                <div className="text-muted-foreground mt-0.5 truncate">"{p.a.content.substring(0, 40)}"</div>
                <div className="text-muted-foreground truncate">vs "{p.b.content.substring(0, 40)}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reinforcements */}
      {result.reinforcements.length > 0 && (
        <div>
          <SectionLabel>Reinforcements ({result.reinforcements.length})</SectionLabel>
          <div className="space-y-1">
            {result.reinforcements.map((p) => (
              <div key={`${p.a.id}-${p.b.id}-${p.type}`} className="text-xs bg-green-900/10 border border-green-800/30 rounded px-2.5 py-1.5">
                <span className="text-green-400">↑</span>
                <span className="text-muted-foreground ml-1 italic">{p.type}</span>
                <div className="text-muted-foreground mt-0.5 truncate">"{p.a.content.substring(0, 40)}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inferred edges */}
      {result.inferred.length > 0 && (
        <div>
          <SectionLabel>Inferred Edges ({result.inferred.length})</SectionLabel>
          <div className="space-y-1">
            {result.inferred.map((e) => (
              <div key={`${e.a.id}-${e.b.id}`} className="text-xs bg-violet-900/10 border border-violet-800/30 rounded px-2.5 py-1.5">
                <span className="text-violet-400">≈</span>
                <span className="text-muted-foreground ml-1 italic">{e.type}</span>
                {e.persisted && <span className="ml-1 text-xs text-violet-600">saved</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

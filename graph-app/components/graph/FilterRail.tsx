"use client";
import { useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { GraphNode, Tag } from "@/lib/types";

interface Props {
  nodes: GraphNode[];
  importanceMin: number;
  onImportanceMin: (v: number) => void;
  activeProject: string | null;
  hiddenProjects: Set<string>;
  onSelectProject: (name: string | null) => void;
  onToggleHide: (name: string) => void;
  tags: Tag[];
  activeTags: Set<string>;
  onToggleTag: (name: string) => void;
  onClearTags: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

export default function FilterRail({
  nodes, importanceMin, onImportanceMin,
  activeProject, hiddenProjects, onSelectProject, onToggleHide,
  tags, activeTags, onToggleTag, onClearTags,
}: Props) {
  const projects = useMemo(() => nodes.filter((n) => "is_project" in n), [nodes]);

  const memoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      if (!("is_project" in n) && !("is_context" in n) && "project_scope" in n && n.project_scope) {
        counts[n.project_scope] = (counts[n.project_scope] ?? 0) + 1;
      }
    }
    return counts;
  }, [nodes]);

  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Importance */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Min importance</SectionLabel>
          <Badge variant="secondary" className="tabular-nums">{importanceMin}</Badge>
        </div>
        <Slider
          value={[importanceMin]}
          onValueChange={([v]) => onImportanceMin(v)}
          min={1}
          max={5}
          step={1}
        />
        <p className="text-[11px] text-muted-foreground">
          Hide memories rated below this. Higher = only the most reinforced.
        </p>
      </div>

      <Separator />

      {/* Projects */}
      <div className="space-y-2">
        <SectionLabel>Projects</SectionLabel>
        <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto -mx-1 px-1">
          <button
            onClick={() => onSelectProject(null)}
            className={cn(
              "text-left text-sm rounded px-2 py-1.5 hover:bg-accent transition-colors",
              !activeProject ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            All projects
          </button>
          {projects.map((p) => {
            const hidden = hiddenProjects.has(p.label);
            const count = memoryCounts[p.label] ?? 0;
            const active = activeProject === p.label && !hidden;
            return (
              <div
                key={p.id}
                className={cn(
                  "group flex items-center gap-1 rounded hover:bg-accent transition-colors",
                  hidden ? "opacity-40" : count === 0 ? "opacity-60" : "",
                )}
              >
                <button
                  onClick={() => !hidden && onSelectProject(active ? null : p.label)}
                  title={p.label}
                  className={cn(
                    "flex-1 min-w-0 text-left text-sm px-2 py-1.5 truncate",
                    active ? "text-primary font-medium" : "text-muted-foreground",
                  )}
                >
                  {p.label.split("/").pop() || p.label}
                </button>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground/70 font-mono tabular-nums shrink-0">
                    {count}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onToggleHide(p.label)}
                  title={hidden ? "Show project" : "Hide project"}
                  className="h-6 w-6 shrink-0 opacity-30 group-hover:opacity-100 transition-opacity"
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Tags */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Tags</SectionLabel>
          {activeTags.size > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClearTags}>
              Clear {activeTags.size}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
          {tags.map((tag) => {
            const active = activeTags.has(tag.name);
            return (
              <button key={tag.id} onClick={() => onToggleTag(tag.name)}>
                <Badge
                  variant={active ? "default" : "outline"}
                  className="cursor-pointer gap-1 font-normal"
                >
                  {tag.name}
                  <span className="tabular-nums opacity-60">{tag.memory_count}</span>
                </Badge>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

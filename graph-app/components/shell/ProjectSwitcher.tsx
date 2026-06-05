"use client";

/**
 * The project switcher — sits to the right of the OpenLTM logo in TopNav.
 * Three resolution states:
 *   1. "all"  → "All projects (global)"  (first-class per spec Q4)
 *   2. a real project name → "projects/foo"
 * Selecting a value navigates to the corresponding route AND writes to
 * ProjectContext (which persists to localStorage).
 *
 * Phase 2 delivers the data wiring (api.projectHealth() → list of known
 * projects). The dropdown body is rendered as a small portal-free popover;
 * for v2.6.0 a real <Select> or shadcn <DropdownMenu> can replace this
 * without changing the public surface.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Globe, FolderTree, Loader2 } from "lucide-react";
import { useProject, ALL_PROJECTS } from "@/components/shell/ProjectContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProjectListItem {
  name: string;
  shortName: string;
}

export default function ProjectSwitcher() {
  const router = useRouter();
  const { activeProject, setActiveProject, isGlobal } = useProject();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load project list when the popover opens.
  useEffect(() => {
    if (!open || items.length > 0) return;
    let alive = true;
    setLoading(true);
    api
      .projectHealth()
      .then((rows) => {
        if (!alive) return;
        setItems(
          rows.map((r) => ({
            name: r.project,
            shortName: r.project.split("/").pop() || r.project,
          })),
        );
      })
      .catch(() => {
        // Non-fatal: dropdown still works with just the "All" option.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, items.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function select(name: string) {
    setActiveProject(name);
    setOpen(false);
    if (name === ALL_PROJECTS) {
      router.push("/projects");
    } else {
      router.push(`/projects/${encodeURIComponent(name)}`);
    }
  }

  const display = isGlobal
    ? { label: "All projects", sub: "global view" }
    : {
        label: (activeProject.split("/").pop() || activeProject),
        sub: activeProject,
      };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors border",
          open
            ? "border-[var(--text-primary)] text-[var(--text-primary)]"
            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border)]",
        )}
        title={isGlobal ? "All projects (global view)" : `Active project: ${activeProject}`}
      >
        {isGlobal ? (
          <Globe className="w-3.5 h-3.5" />
        ) : (
          <FolderTree className="w-3.5 h-3.5" />
        )}
        <span className="max-w-[140px] truncate">{display.label}</span>
        <ChevronsUpDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 w-72 z-50 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg overflow-hidden"
        >
          {/* Global option — always first, per spec Q4. */}
          <button
            role="option"
            aria-selected={isGlobal}
            onClick={() => select(ALL_PROJECTS)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
              isGlobal
                ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">All projects</span>
            <span className="text-[10px] text-[var(--text-muted)]">global</span>
            {isGlobal && <Check className="w-3.5 h-3.5 text-[var(--accent-lime)]" />}
          </button>

          <div className="h-px bg-[var(--border)]" />

          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading projects…
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No projects yet.</div>
            ) : (
              items.map((item) => {
                const selected = !isGlobal && activeProject === item.name;
                return (
                  <button
                    key={item.name}
                    role="option"
                    aria-selected={selected}
                    onClick={() => select(item.name)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                      selected
                        ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    <FolderTree className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 truncate">{item.shortName}</span>
                    {selected && <Check className="w-3.5 h-3.5 text-[var(--accent-lime)]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

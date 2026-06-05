"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Pin, AlertOctagon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { GraphNode } from "@/lib/types";

interface InspectorContextMenuProps {
  node: GraphNode;
}

interface MenuState {
  x: number;
  y: number;
}

export default function InspectorContextMenu({ node }: InspectorContextMenuProps) {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function handleContext(e: React.MouseEvent) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 160);
    setMenu({ x, y });
  }

  function openInProject() {
    const scope = (node as { project_scope?: string | null }).project_scope;
    if (scope) router.push(`/projects/${encodeURIComponent(scope)}/memories`);
    setMenu(null);
  }

  function markPermanent() {
    console.warn("Mark permanent is a v2.8 backend feature — no-op in v2.7.");
    setMenu(null);
  }

  function findConflicts() {
    console.warn("Find conflicts is a v2.8 backend feature — no-op in v2.7.");
    setMenu(null);
  }

  return (
    <div onContextMenu={handleContext} className="contents">
      {menu && (
        <div
          ref={ref}
          role="menu"
          className="fixed z-50 w-52 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg p-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={openInProject}
            disabled={!(node as { project_scope?: string | null }).project_scope}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="flex-1">Open in project</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={markPermanent}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <Pin className="w-3.5 h-3.5" />
            <span className="flex-1">Mark permanent</span>
            <span className="text-[10px] text-[var(--text-muted)]">v2.8</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={findConflicts}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span className="flex-1">Find conflicts</span>
            <span className="text-[10px] text-[var(--text-muted)]">v2.8</span>
          </button>
        </div>
      )}
    </div>
  );
}

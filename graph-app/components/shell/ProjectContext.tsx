"use client";

/**
 * Global state for the active project. Backed by React Context for v2.6.0;
 * the spec calls for Zustand in a follow-up. The shape is intentionally small
 * — the switcher and the 3-pane shell both subscribe to `activeProject`.
 *
 * Resolution order on mount:
 *   1. localStorage["ltm.activeProject"] (string)
 *   2. URL param /projects/[name] (if any)
 *   3. "all" (default — global view)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useParams } from "next/navigation";

const STORAGE_KEY = "ltm.activeProject";
export const ALL_PROJECTS = "all";

export interface ActiveProjectState {
  /** "all" means the global view across every project, otherwise the project name as registered. */
  activeProject: string;
  /** Set the active project. Persists to localStorage. */
  setActiveProject: (name: string) => void;
  /** True when the active project is the global "all" view. */
  isGlobal: boolean;
}

const ProjectContext = createContext<ActiveProjectState | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ name?: string }>();
  const [activeProject, setActiveProjectState] = useState<string>(ALL_PROJECTS);

  // Hydrate from localStorage on first mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setActiveProjectState(stored);
    } catch {
      // localStorage may be unavailable (private mode, SSR); fall through.
    }
  }, []);

  // Sync from URL when the route changes — visiting /projects/[name] becomes
  // the new active project, and leaving a project route falls back to "all".
  useEffect(() => {
    if (params?.name) {
      const decoded = decodeURIComponent(params.name);
      setActiveProjectState(decoded);
      try {
        window.localStorage.setItem(STORAGE_KEY, decoded);
      } catch {
        // ignore
      }
    } else if (pathname?.startsWith("/project/") || pathname?.startsWith("/projects/")) {
      // On a project shell but no name — keep current, nothing to do.
    } else {
      // Not on a project route at all — global.
      setActiveProjectState(ALL_PROJECTS);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, [pathname, params?.name]);

  const setActiveProject = useCallback((name: string) => {
    setActiveProjectState(name);
    try {
      if (name === ALL_PROJECTS) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, name);
      }
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<ActiveProjectState>(
    () => ({
      activeProject,
      setActiveProject,
      isGlobal: activeProject === ALL_PROJECTS,
    }),
    [activeProject, setActiveProject],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ActiveProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used inside <ProjectProvider>");
  }
  return ctx;
}

"use client";

/**
 * The 56px-wide vertical sub-nav for the project layer. Six items, icon-only
 * with a tooltip. Selected item gets a 2px left bar in --accent-lime — the
 * first rationed use of the acid-lime accent per docs/FRONTEND-REDESIGN-2026-06.md
 * §13. Mercury blue is NOT used here; that's reserved for the Settings page.
 */

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  LayoutDashboard,
  ListTree,
  History,
  Share2,
  HeartPulse,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubNavItem {
  href: (projectName: string) => string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Exact path or prefix match. */
  match: (pathname: string) => boolean;
}

const ITEMS: SubNavItem[] = [
  {
    href: (n) => `/projects/${encodeURIComponent(n)}`,
    label: "Overview",
    icon: LayoutDashboard,
    match: (p) => /^\/projects\/[^/]+\/?$/.test(p),
  },
  {
    href: (n) => `/projects/${encodeURIComponent(n)}/memories`,
    label: "Memories",
    icon: ListTree,
    match: (p) => /^\/projects\/[^/]+\/memories/.test(p),
  },
  {
    href: (n) => `/projects/${encodeURIComponent(n)}/timeline`,
    label: "Timeline",
    icon: History,
    match: (p) => /^\/projects\/[^/]+\/timeline/.test(p),
  },
  {
    href: (n) => `/projects/${encodeURIComponent(n)}/connections`,
    label: "Connections",
    icon: Share2,
    match: (p) => /^\/projects\/[^/]+\/connections/.test(p),
  },
  {
    href: (n) => `/projects/${encodeURIComponent(n)}/health`,
    label: "Health",
    icon: HeartPulse,
    match: (p) => /^\/projects\/[^/]+\/health/.test(p),
  },
  {
    href: (n) => `/projects/${encodeURIComponent(n)}/settings`,
    label: "Project Settings",
    icon: SettingsIcon,
    match: (p) => /^\/projects\/[^/]+\/settings/.test(p),
  },
];

export default function ProjectSubNav() {
  const pathname = usePathname() || "";
  const params = useParams<{ name: string }>();
  const projectName = params?.name ? decodeURIComponent(params.name) : "";

  return (
    <nav
      aria-label="Project sub-navigation"
      className="w-14 shrink-0 h-full border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col items-center py-3 gap-1"
    >
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={label}
            href={href(projectName)}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative w-10 h-10 flex items-center justify-center rounded-md transition-colors",
              active
                ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/60",
            )}
          >
            {/* Acid-lime 2px left bar — rationed use #1 per spec §13. */}
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm bg-[var(--accent-lime)]"
              />
            )}
            <Icon className="w-4 h-4" />
          </Link>
        );
      })}
    </nav>
  );
}

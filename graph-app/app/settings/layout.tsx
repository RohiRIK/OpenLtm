"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Settings as SettingsIcon, Sliders, HeartPulse, Code2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/settings", label: "System", icon: SettingsIcon, exact: true },
  { href: "/settings/behavior", label: "Behavior", icon: Sliders, exact: false },
  { href: "/settings/health", label: "Health", icon: HeartPulse, exact: false },
  { href: "/settings/advanced", label: "Advanced", icon: Code2, exact: false },
  { href: "/settings/about", label: "About", icon: Info, exact: false },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/settings";

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="flex items-center gap-2 mb-6">
          <Brain className="w-5 h-5 text-[var(--accent-blue)]" />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Settings</h1>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-8">
          <nav aria-label="Settings sections" className="space-y-1">
            {SECTIONS.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors border",
                    active
                      ? "border-[var(--accent-blue)] text-[var(--text-primary)] bg-[var(--bg-secondary)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/60",
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

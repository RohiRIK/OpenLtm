"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, FolderTree, Network, Inbox, Settings, Menu, X } from "lucide-react";
import Omnibar from "@/components/shell/Omnibar";
import BackendStatusChip from "@/components/shell/BackendStatusChip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Projects", icon: FolderTree },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TopNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-4 h-14 bg-transparent border-b border-[var(--border)]">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 text-[var(--text-primary)] hover:opacity-80 transition-opacity">
            <Brain className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <span className="font-semibold text-sm tracking-tight hidden sm:inline-block">OpenLTM</span>
          </Link>
          
          {/* Navigation Links — desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-[22.5px] text-[12px] transition-colors border",
                    active 
                      ? "border-[var(--text-primary)] text-[var(--text-primary)]" 
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Center - Omnibar */}
        <div className="flex-1 flex justify-center px-4 max-w-xl">
          <Omnibar />
        </div>

        {/* Right - Status + Mobile hamburger */}
        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          <BackendStatusChip />
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="md:hidden flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile dropdown nav */}
      {mobileOpen && (
        <div className="fixed top-14 inset-x-0 z-50 bg-[var(--bg-primary)] border-b border-[var(--border)] md:hidden">
          <nav className="flex flex-col px-4 py-3 gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-sm transition-colors",
                    active
                      ? "text-[var(--text-primary)] border border-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}

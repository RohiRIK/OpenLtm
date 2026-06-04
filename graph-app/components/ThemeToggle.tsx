"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useRef } from "react";
import { Palette, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { id: "studio", label: "Studio Black", color: "#dc5000" },
  { id: "midnight", label: "Midnight Indigo", color: "#3b82f6" },
  { id: "forest", label: "Forest Void", color: "#10b981" },
  { id: "concrete", label: "Monochrome Concrete", color: "#ffffff" },
  { id: "wine", label: "Cyberpunk Wine", color: "#e11d48" },
  { id: "ocean", label: "Abyssal Ocean", color: "#06b6d4" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!mounted) return <div className="w-8 h-8" />;

  const currentTheme = THEMES.find((t) => t.id === theme) || THEMES[0]!;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-transparent hover:border-[var(--border)]"
        title="Change theme"
      >
        <Palette className="w-4 h-4" />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentTheme.color }} />
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-[var(--bg-primary)] border border-[var(--border)] rounded-[12px] shadow-2xl overflow-hidden z-50">
          <div className="flex flex-col py-1">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 text-xs text-left transition-colors",
                  theme === t.id
                    ? "bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                )}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

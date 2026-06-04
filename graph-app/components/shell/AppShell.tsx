"use client";

import TopNav from "@/components/shell/TopNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen min-h-0 bg-transparent text-[var(--text-primary)] selection:bg-[var(--accent)]/30">
      <TopNav />
      {/* pt-14 accounts for the 3.5rem (h-14) height of the fixed TopNav */}
      <main className="flex-1 min-h-0 pt-14 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}

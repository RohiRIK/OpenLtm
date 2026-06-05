"use client";

import TopNav from "@/components/shell/TopNav";
import { ProjectProvider } from "@/components/shell/ProjectContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <div className="flex flex-col h-screen min-h-0 bg-transparent text-[var(--text-primary)] selection:bg-[var(--accent)]/30">
        <TopNav />
        <main className="flex-1 min-h-0 pt-14 overflow-hidden flex flex-col">
          {children}
        </main>
      </div>
    </ProjectProvider>
  );
}

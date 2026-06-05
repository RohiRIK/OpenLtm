"use client";

import ProjectSubNav from "@/components/shell/ProjectSubNav";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full">
      <ProjectSubNav />
      <div className="flex-1 min-w-0 h-full overflow-hidden">{children}</div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import OverviewCanvas from "@/components/OverviewCanvas";
import HealthView from "@/components/HealthView";
import GraphView from "@/components/GraphView";
import ProjectSheet from "@/components/ProjectSheet";

export default function Home() {
  const [openProject, setOpenProject] = useState<string | null>(null);

  return (
    <Tabs defaultValue="overview" className="flex flex-col h-full gap-0">
      <div className="px-4 pt-3 border-b border-[var(--border)]">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
        <OverviewCanvas onOpenProject={setOpenProject} />
      </TabsContent>
      <TabsContent value="graph" className="flex-1 min-h-0 mt-0">
        <GraphView />
      </TabsContent>
      <TabsContent value="health" className="flex-1 min-h-0 mt-0">
        <HealthView onOpenProject={setOpenProject} />
      </TabsContent>

      <ProjectSheet projectName={openProject} onClose={() => setOpenProject(null)} />
    </Tabs>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Database, Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { Capabilities } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export default function BackendStatusChip() {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    let alive = true;
    api.capabilities().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const vec = caps?.vec ?? false;
  const honker = caps?.honker ?? false;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={vec ? "default" : "secondary"}
              className="gap-1 font-normal"
              aria-label={`Vector search ${vec ? "on" : "off"}`}
            >
              <Database className="w-3 h-3" />
              vec
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {vec
              ? "sqlite-vec active — semantic KNN search enabled"
              : "sqlite-vec unavailable — keyword search only"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={honker ? "default" : "secondary"}
              className="gap-1 font-normal"
              aria-label={`Live updates ${honker ? "on" : "off"}`}
            >
              <Radio className="w-3 h-3" />
              live
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {honker
              ? "Honker active — live push updates"
              : "Honker unavailable — falling back to polling"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

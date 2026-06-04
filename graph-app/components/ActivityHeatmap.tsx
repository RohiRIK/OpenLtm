"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";

const WEEKS = 52;
const DAY_LABELS = ["", "M", "", "W", "", "F", ""];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function colorForCount(count: number, max: number): string {
  if (count === 0) return 'var(--bg-primary)';
  if (max === 0) return 'var(--bg-primary)';
  const ratio = count / max;
  if (ratio <= 0.33) return 'var(--node-memory)';
  if (ratio <= 0.66) return "#8b4513";
  return 'var(--accent)';
}

export default function ActivityHeatmap() {
  const [dayCounts, setDayCounts] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let alive = true;
    api.graph().then(({ nodes }) => {
      if (!alive) return;
      const counts = new Map<string, number>();
      for (const node of nodes) {
        if (!node.created_at) continue;
        const day = node.created_at.slice(0, 10); // YYYY-MM-DD
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      setDayCounts(counts);
    }).catch(() => {
      if (alive) setDayCounts(new Map());
    });
    return () => { alive = false; };
  }, []);

  const { grid, monthLabels, maxCount } = useMemo(() => {
    const today = new Date();
    const totalDays = WEEKS * 7;
    // Align start to a Sunday
    const endDay = new Date(today);
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - totalDays + 1);
    // Align to previous Sunday
    const dayOfWeek = startDay.getDay(); // 0=Sun
    startDay.setDate(startDay.getDate() - dayOfWeek);

    const cells: { date: string; count: number; dayOfWeek: number; weekIndex: number }[] = [];
    const months: { label: string; weekIndex: number }[] = [];
    let max = 0;
    let lastMonth = -1;

    const cursor = new Date(startDay);
    let weekIdx = 0;
    let dayIdx = 0;

    while (cursor <= endDay || dayIdx % 7 !== 0 || cells.length < totalDays) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const count = dayCounts?.get(dateStr) ?? 0;
      if (count > max) max = count;

      const dow = cursor.getDay(); // 0=Sun
      if (dow === 0 && dayIdx > 0) weekIdx++;

      if (cursor.getMonth() !== lastMonth) {
        lastMonth = cursor.getMonth();
        months.push({ label: MONTH_NAMES[lastMonth], weekIndex: weekIdx });
      }

      cells.push({ date: dateStr, count, dayOfWeek: dow, weekIndex: weekIdx });
      cursor.setDate(cursor.getDate() + 1);
      dayIdx++;

      // Stop after filling the grid
      if (weekIdx >= WEEKS && dow === 6) break;
    }

    return { grid: cells, monthLabels: months, maxCount: max };
  }, [dayCounts]);

  if (dayCounts === null) {
    return (
      <div className="h-[120px] animate-pulse rounded-[12px] bg-[var(--node-memory)]/20" />
    );
  }

  // Build a 2D grid: weeks as columns, days as rows
  const totalWeeks = Math.max(...grid.map(c => c.weekIndex)) + 1;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest">Activity</h3>
      <div className="flex gap-1">
        {/* Day labels column */}
        <div className="flex flex-col gap-[3px] pr-1">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className="h-[12px] w-[16px] text-[9px] text-[var(--text-muted)] leading-[12px] text-right">
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex flex-col gap-0.5 overflow-hidden">
          {/* Month labels */}
          <div className="flex gap-[3px] mb-0.5">
            {Array.from({ length: totalWeeks }, (_, wi) => {
              const monthLabel = monthLabels.find(m => m.weekIndex === wi);
              return (
                <div key={wi} className="w-[12px] text-[9px] text-[var(--text-muted)] text-center leading-[12px] shrink-0">
                  {monthLabel ? monthLabel.label.charAt(0) + monthLabel.label.charAt(1) + monthLabel.label.charAt(2) : ""}
                </div>
              );
            })}
          </div>

          {/* Heatmap rows */}
          {Array.from({ length: 7 }, (_, dow) => (
            <div key={dow} className="flex gap-[3px]">
              {Array.from({ length: totalWeeks }, (_, wi) => {
                const cell = grid.find(c => c.weekIndex === wi && c.dayOfWeek === dow);
                return (
                  <div
                    key={wi}
                    className="w-[12px] h-[12px] rounded-[2px] transition-colors"
                    style={{ backgroundColor: cell ? colorForCount(cell.count, maxCount) : 'var(--bg-primary)' }}
                    title={cell ? `${cell.date}: ${cell.count} memories` : ""}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

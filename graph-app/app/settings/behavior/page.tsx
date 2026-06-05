"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ClaudeLtmConfig } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

const TOGGLES: { key: keyof ClaudeLtmConfig; label: string; help: string }[] = [
  {
    key: "graphReasoning",
    label: "Auto-relate new memories",
    help: "Trace chains of related memories to surface conflicts and reinforcements.",
  },
  {
    key: "autoRelate",
    label: "Suggest contradiction detection",
    help: "When a new memory contradicts an old one, surface the conflict for review.",
  },
  {
    key: "decayEnabled",
    label: "Decay unused memories",
    help: "Lowers confidence of memories that go unused, so stale knowledge fades.",
  },
];

export default function BehaviorSection() {
  const [ltm, setLtm] = useState<ClaudeLtmConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getConfig()
      .then((c) => alive && setLtm(c.ltm))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function patch(p: Partial<ClaudeLtmConfig>) {
    if (!ltm) return;
    setLtm({ ...ltm, ...p });
    setSaving(true);
    try {
      await api.updateConfig(p);
    } finally {
      setTimeout(() => setSaving(false), 600);
    }
  }

  if (!ltm) {
    return <div className="h-64 rounded-md border border-dashed border-[var(--border)] animate-pulse bg-[var(--bg-secondary)]" />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Reasoning</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">How the capture hook reasons about new memories.</p>
        </div>
        <div className="space-y-4">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)]">{t.label}</div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.help}</p>
              </div>
              <Switch
                checked={Boolean(ltm[t.key])}
                onCheckedChange={(v) => void patch({ [t.key]: v } as Partial<ClaudeLtmConfig>)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Decay</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">How fast memory confidence decays when unused.</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Inject top N</div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">How many memories to inject into context at session start.</p>
            </div>
            <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">{ltm.injectTopN}</span>
          </div>
          <Slider
            value={[ltm.injectTopN]}
            onValueChange={([v]) => setLtm({ ...ltm, injectTopN: v })}
            onValueCommit={([v]) => void patch({ injectTopN: v })}
            min={1}
            max={20}
            step={1}
            className="py-2"
          />
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Inbox</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">How pending memories are aged out.</p>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--text-primary)]">Auto-clear Inbox after</span>
          <span className="font-mono text-[var(--text-primary)]">30 days</span>
        </div>
      </section>

      {saving && <p className="text-[10px] text-[var(--accent-blue)]">Saving…</p>}
    </div>
  );
}

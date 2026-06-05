"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Settings as SettingsIcon, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ClaudeLtmConfig } from "@/lib/types";

export default function ProjectSettingsPage() {
  const { name } = useParams<{ name: string }>();
  const projectName = decodeURIComponent(name);

  const [config, setConfig] = useState<ClaudeLtmConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getConfig()
      .then((c) => alive && setConfig(c.ltm))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  async function patch(updates: Partial<ClaudeLtmConfig>) {
    if (!config) return;
    const next = { ...config, ...updates };
    setConfig(next);
    setSaving(true);
    try {
      await api.updateConfig(updates);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <div className="h-full overflow-y-auto p-6"><p className="text-sm text-destructive">Failed to load: {error}</p></div>;
  }

  if (!config) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg bg-[var(--node-memory)] animate-pulse" />
        <Skeleton className="h-[300px] w-full rounded-xl bg-[var(--node-memory)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" /> Project Settings
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Per-project overrides. System-wide defaults are in <a href="/settings" className="text-[var(--accent)] hover:underline">Settings</a>.
          </p>
        </header>

        <Section title="Context rules" desc="What the capture hook should record for this project.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Toggle
              label="Auto-capture decisions"
              hint="Save explicit decisions from the session."
              checked={config.graphReasoning}
              onChange={(v) => patch({ graphReasoning: v })}
            />
            <Toggle
              label="Auto-capture gotchas"
              hint="Surface surprising or non-obvious patterns."
              checked={config.autoRelate}
              onChange={(v) => patch({ autoRelate: v })}
            />
            <Toggle
              label="Require confirmation"
              hint="Memories stay pending until you confirm them."
              checked={false}
              onChange={() => undefined}
            />
            <Toggle
              label="Allow cross-project relations"
              hint="Memories can link across project boundaries."
              checked={config.decayEnabled}
              onChange={(v) => patch({ decayEnabled: v })}
            />
          </div>
        </Section>

        <Section title="Memory rules" desc="Defaults for newly captured memories in this project.">
          <div className="space-y-5">
            <SliderRow
              label="Importance default"
              hint="Default importance score for new memories."
              min={1} max={5} step={1} value={config.injectTopN}
              onCommit={(v) => patch({ injectTopN: v })}
            />
            <SliderRow
              label="Confidence threshold"
              hint="Memories below this score are flagged for review."
              min={0} max={1} step={0.05} value={0.7}
              onCommit={() => undefined}
            />
          </div>
        </Section>

        <Section title="Connections" desc="How the auto-relate strategy behaves for this project.">
          <Toggle
            label="Suggest relations on capture"
            hint="After capture, run a similarity pass and propose edges."
            checked={config.autoRelate}
            onChange={(v) => patch({ autoRelate: v })}
          />
        </Section>

        <Section title="Danger zone" desc="Destructive actions for this project." border="crimson">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Reset to system defaults</div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Discards every per-project override above. Requires typing the project name to confirm.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-[#e5484d] text-[#e5484d] hover:bg-[#e5484d] hover:text-white"
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Reset
            </Button>
          </div>
        </Section>

        {saving && (
          <p className="text-[10px] text-[var(--text-muted)]">Saving…</p>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
  border = "default",
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  border?: "default" | "crimson";
}) {
  return (
    <section
      className={
        "rounded-xl p-6 bg-[var(--bg-secondary)] space-y-4 border " +
        (border === "crimson" ? "border-[#e5484d]/60" : "border-[var(--border)]")
      }
    >
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SliderRow({ label, hint, value, min, max, step, onCommit }: { label: string; hint: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>
        </div>
        <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueCommit={([v]) => onCommit(v)}
        className="py-2"
      />
    </div>
  );
}

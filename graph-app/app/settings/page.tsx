"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { SettingsModels } from "@/lib/types";
import SettingsForm from "@/components/SettingsForm";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export default function SystemSection() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [models, setModels] = useState<SettingsModels | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbPath, setDbPath] = useState<string>("");
  const [dbSize, setDbSize] = useState<string>("");

  const load = useCallback(async () => {
    const [s, m, stRes] = await Promise.allSettled([
      api.getSettings(),
      api.getModels(),
      api.storage(),
    ]);
    if (s.status === "fulfilled") setSettings(s.value);
    if (m.status === "fulfilled") setModels(m.value);
    if (stRes.status === "fulfilled") {
      setDbPath(stRes.value.path);
      setDbSize(formatBytes(stRes.value.size));
    } else {
      setDbSize("— (storage endpoint offline)");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (updated: Record<string, string>) => {
    setSaving(true);
    try {
      await api.updateSettings(updated);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const handleReveal = async () => {
    if (!dbPath) return;
    const res = await api.reveal(dbPath);
    if (!res.ok) {
      setDbSize(`— (${res.error ?? "open failed"})`);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">AI providers</h2>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          One provider can serve both embedding and LLM roles, or two providers can split the work.
        </p>
        {models ? (
          <SettingsForm settings={settings} models={models} onSave={handleSave} saving={saving} />
        ) : (
          <div className="h-48 rounded-md border border-dashed border-[var(--border)] animate-pulse bg-[var(--bg-secondary)]" />
        )}
        {saved && (
          <p className="mt-3 text-xs text-[var(--accent-blue)]">Saved.</p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
        <div className="flex items-start gap-3">
          <Database className="w-4 h-4 mt-0.5 text-[var(--text-muted)]" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Storage</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">The SQLite database that holds every memory.</p>
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-dashed border-[var(--border)]">
                <dt className="text-[var(--text-muted)]">Path</dt>
                <dd className="font-mono text-[var(--text-primary)] truncate" title={dbPath || "openltm.db (next to plugin)"}>
                  {dbPath || "openltm.db"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-dashed border-[var(--border)]">
                <dt className="text-[var(--text-muted)]">Size on disk</dt>
                <dd className="font-mono text-[var(--text-primary)]">{dbSize || "—"}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={handleReveal}
              disabled={!dbPath}
              className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:no-underline"
            >
              Open in Finder <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

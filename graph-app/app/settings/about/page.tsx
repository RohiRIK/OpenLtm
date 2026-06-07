"use client";

import { useEffect, useState } from "react";
import { MessageCircle, FileText, Heart, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";

interface AboutData {
  version: string;
  schemaVersion: number;
  lastRecall: string | null;
  license: string;
  feedbackUrl: string;
  changelogHref: string;
}

export default function AboutSection() {
  const [data, setData] = useState<AboutData | null>(null);

  useEffect(() => {
    let alive = true;
    api.capabilities()
      .then(() => {
        if (!alive) return;
        setData({
          version: "2.7.0",
          schemaVersion: 4,
          lastRecall: null,
          license: "MIT — © RohiRIK",
          feedbackUrl: "https://github.com/RohiRIK/OpenLtm/issues",
          changelogHref: "/api/changelog",
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Build info</h2>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <Row label="Version" value={data?.version ?? "—"} mono />
          <Row label="DB schema" value={data ? `v${data.schemaVersion}` : "—"} mono />
          <Row label="License" value={data?.license ?? "—"} />
          <Row label="Last recall" value={data?.lastRecall ?? "never"} mono />
        </dl>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Resources</h2>
        <a
          href={data?.feedbackUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-[var(--accent-blue)] hover:underline"
        >
          <MessageCircle className="w-3.5 h-3.5" /> Send feedback
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href="/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-[var(--accent-blue)] hover:underline"
        >
          <FileText className="w-3.5 h-3.5" /> What's new
          <ExternalLink className="w-3 h-3" />
        </a>
      </section>

      <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
        Built with <Heart className="w-3 h-3 text-red-500" /> by RohiRIK
      </p>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--text-muted)] text-[10px] uppercase tracking-widest mb-1">{label}</dt>
      <dd className={mono ? "font-mono text-[var(--text-primary)]" : "text-[var(--text-primary)]"}>{value}</dd>
    </div>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import type { ConfigExplorerData, AgentEntry, HookEntry, RuleEntry, SkillEntry } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Code2, ChevronDown } from "lucide-react";

function MarkdownLite({ text }: { text: string }) {
  const html = useMemo(
    () =>
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`(.+?)`/g, '<code class="px-1 rounded bg-[var(--bg-tertiary)] text-[var(--accent)]">$1</code>')
        .split("\n")
        .map((l) => `<p class="text-xs leading-relaxed mb-1">${l}</p>`)
        .join(""),
    [text],
  );
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function AdvancedSection() {
  const [data, setData] = useState<ConfigExplorerData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.configExplorer()
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-[var(--text-muted)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">System explorer</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Skills, agents, hooks, and rules. Most users never need this — keep collapsed unless debugging.
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-5">
          {!data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {data.skills.length > 0 && <SkillsList skills={data.skills} />}
              {data.agents.length > 0 && <AgentsList agents={data.agents} />}
              {data.hooks.length > 0 && <HooksList hooks={data.hooks} />}
              {data.rules.length > 0 && <RulesList rules={data.rules} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SkillsList({ skills }: { skills: SkillEntry[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(t) || s.description.toLowerCase().includes(t));
  }, [skills, q]);
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Skills ({skills.length})</h3>
      <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      <Accordion type="single" collapsible className="space-y-2">
        {filtered.map((s) => (
          <AccordionItem key={s.name} value={s.name} className="rounded-md border border-[var(--border)] px-3 bg-[var(--bg-primary)]">
            <AccordionTrigger className="text-sm hover:no-underline py-2">
              <span className="flex items-center gap-2 text-[var(--text-primary)]">
                {s.name}
                {s.slashCommand && <Badge variant="outline" className="font-mono text-[10px]">{s.slashCommand}</Badge>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-xs text-[var(--text-muted)] space-y-2 pb-3">
              <p>{s.description}</p>
              <p className="font-mono text-[10px] opacity-60">{s.path}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function AgentsList({ agents }: { agents: AgentEntry[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Agents ({agents.length})</h3>
      <Accordion type="single" collapsible className="space-y-2">
        {agents.map((a) => (
          <AccordionItem key={a.name} value={a.name} className="rounded-md border border-[var(--border)] px-3 bg-[var(--bg-primary)]">
            <AccordionTrigger className="text-sm hover:no-underline py-2">
              <Badge variant="outline" className="font-mono">{a.name}</Badge>
            </AccordionTrigger>
            <AccordionContent className="text-xs text-[var(--text-muted)] space-y-1 pb-3">
              <p>{a.description || "—"}</p>
              <p className="font-mono text-[10px] opacity-60">{a.path}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function HooksList({ hooks }: { hooks: HookEntry[] }) {
  const grouped = useMemo(
    () =>
      hooks.reduce<Record<string, HookEntry[]>>((acc, h) => {
        (acc[h.event] ??= []).push(h);
        return acc;
      }, {}),
    [hooks],
  );
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Hooks ({hooks.length})</h3>
      <div className="space-y-3">
        {Object.entries(grouped).map(([event, list]) => (
          <div key={event} className="rounded-md border border-[var(--border)] overflow-hidden">
            <div className="px-3 py-1.5 bg-[var(--bg-tertiary)]/40 flex items-center gap-2 text-xs">
              <Badge variant="outline" className="font-mono">{event}</Badge>
              <span className="text-[var(--text-muted)]">{list.length}</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {list.map((h, i) => (
                <li key={i} className="px-3 py-2 text-xs flex items-center gap-3">
                  <span className="font-mono text-[var(--text-muted)] w-1/3 truncate">{h.matcher ?? "—"}</span>
                  <span className="font-mono text-[var(--text-primary)] flex-1 truncate" title={h.description}>{h.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesList({ rules }: { rules: RuleEntry[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Rules ({rules.length})</h3>
      <Accordion type="single" collapsible className="space-y-2">
        {rules.map((r) => (
          <AccordionItem key={r.name} value={r.name} className="rounded-md border border-[var(--border)] px-3 bg-[var(--bg-primary)]">
            <AccordionTrigger className="text-sm hover:no-underline py-2 text-[var(--text-primary)]">{r.name}</AccordionTrigger>
            <AccordionContent className="pb-3 max-h-96 overflow-y-auto custom-scrollbar">
              <MarkdownLite text={r.content} />
              <p className="font-mono text-[10px] text-[var(--text-muted)] opacity-60 mt-2">{r.path}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Play } from "lucide-react";
import { api } from "@/lib/api";
import type { 
  JanitorRunResult, 
  SettingsModels,
  AgentEntry,
  ClaudeLtmConfig,
  ConfigExplorerData,
  HookEntry,
  RuleEntry,
  SkillEntry,
} from "@/lib/types";
import SettingsForm from "@/components/SettingsForm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AnimatedStatusBadge } from "@/components/ui/animated-status-badge";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

const TOGGLES: { key: keyof ClaudeLtmConfig; label: string; help: string }[] = [
  {
    key: "graphReasoning",
    label: "Graph reasoning",
    help: "Traces chains of related memories to surface conflicts and reinforcements.",
  },
  {
    key: "autoRelate",
    label: "Auto-relate",
    help: "Automatically links new memories to similar existing ones.",
  },
  {
    key: "decayEnabled",
    label: "Memory decay",
    help: "Lowers confidence of memories that go unused, so stale knowledge fades.",
  },
];

function inlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code class="bg-[var(--bg-tertiary)] px-1 rounded text-[var(--accent)] text-[10px]">$1</code>');
}

function MarkdownContent({ text }: { text: string }) {
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  const lines = text.split("\n");

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-0.5 mb-2 text-[var(--text-muted)]">
          {listItems.map((item, i) => (
            <li key={`li-${i}`} className="text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />
          ))}
        </ul>,
      );
      listItems = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("### ")) {
      flushList();
      elements.push(<h4 key={`h4-${i}`} className="text-xs font-semibold mt-3 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(<h3 key={`h3-${i}`} className="text-sm font-semibold mt-4 mb-1 border-b border-[var(--border)] pb-0.5">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      flushList();
      elements.push(<h2 key={`h2-${i}`} className="text-sm font-bold mt-2 mb-2">{line.slice(2)}</h2>);
    } else if (/^[-*] /.test(line)) {
      listItems.push(line.replace(/^[-*] /, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={`p-${i}`} className="text-xs text-[var(--text-muted)] leading-relaxed mb-1" dangerouslySetInnerHTML={{ __html: inlineMarkdown(line) }} />,
      );
    }
  }
  flushList();
  return <div>{elements}</div>;
}

function formatKeeperResult(r: JanitorRunResult): string {
  return (
    `Done in ${r.durationMs}ms: ${r.embed.embedded} embedded, ` +
    `${r.decay.decayed} decayed (${r.decay.deprecated} deprecated), ` +
    `${r.promote.promoted} promoted, ${r.dedup.candidatesFound} dedup candidates` +
    (r.errors.length > 0 ? ` | Errors: ${r.errors.join("; ")}` : "")
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [models, setModels] = useState<SettingsModels | null>(null);
  const [ltm, setLtm] = useState<ClaudeLtmConfig | null>(null);
  const [explorer, setExplorer] = useState<ConfigExplorerData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [janitorStatus, setJanitorStatus] = useState<{ running: boolean; lastRun: string | null } | null>(null);
  const [janitorRunning, setJanitorRunning] = useState(false);
  const [janitorResult, setJanitorResult] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  };

  const loadData = useCallback(async () => {
    const [s, m, js, c, exp] = await Promise.all([
      api.getSettings(),
      api.getModels(),
      api.janitorStatus(),
      api.getConfig(),
      api.configExplorer()
    ]);
    setSettings(s);
    setModels(m);
    setJanitorStatus(js);
    setLtm(c.ltm);
    setExplorer(exp);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => stopPolling, []);

  const handleSave = async (updated: Record<string, string>) => {
    setSaving(true);
    try {
      await api.updateSettings(updated);
      setSettings(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  async function patchLtm(p: Partial<ClaudeLtmConfig>) {
    if (!ltm) return;
    const next = { ...ltm, ...p };
    setLtm(next);
    try {
      await api.updateConfig(p);
      setSaved(true);
    } catch (e) {
      // ignore
    }
  }

  const handleRunJanitor = async () => {
    setJanitorRunning(true);
    setJanitorResult(null);
    try {
      await api.runJanitor();
    } catch (e) {
      setJanitorResult(`Error: ${String(e)}`);
      setJanitorRunning(false);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.janitorStatus();
        if (!status.running) {
          stopPolling();
          setJanitorRunning(false);
          setJanitorStatus({ running: false, lastRun: status.lastRun });
          if (status.lastResult) setJanitorResult(formatKeeperResult(status.lastResult));
        }
      } catch { /* ignore transient errors */ }
    }, 2000);

    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setJanitorRunning(false);
      setJanitorResult("Timed out waiting for Memory Keeper to complete.");
    }, 60_000);
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Settings & Config</h1>
            <p className="text-sm text-muted-foreground mt-2">
              System configuration, API keys, AI models, and memory behavior toggles.
            </p>
          </div>
          <AnimatedStatusBadge trigger={saved} onAnimationComplete={() => setSaved(false)} />
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-xl font-medium">Provider Settings</h2>
              {models ? (
                <SettingsForm settings={settings} models={models} onSave={handleSave} saving={saving} />
              ) : (
                <div className="space-y-4">
                  <Skeleton className="h-28 w-full rounded-xl" />
                  <Skeleton className="h-48 w-full rounded-xl" />
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-medium">Maintenance</h2>
              <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Memory Keeper</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Run decay, promote, dedup, and embedding generation.
                      {janitorStatus?.lastRun && (
                        <span className="block mt-1">
                          Last run: {new Date(janitorStatus.lastRun).toLocaleString()}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => void handleRunJanitor()} disabled={janitorRunning} className="bg-white/10 hover:bg-white/20 text-white border border-white/10">
                    <Play className="w-3.5 h-3.5 mr-1" />
                    {janitorRunning ? "Running…" : "Run Now"}
                  </Button>
                </div>
                {janitorResult && (
                  <div className="mt-4 text-xs px-3 py-2 rounded-lg bg-black/40 border border-white/5 text-muted-foreground font-mono">
                    {janitorResult}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-xl font-medium">Behavior Toggles</h2>
              <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6 space-y-6">
                  {!ltm ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <>
                      {TOGGLES.map((t) => (
                        <div key={t.key} className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{t.label}</div>
                            <p className="text-xs text-muted-foreground mt-1">{t.help}</p>
                          </div>
                          <Switch
                            checked={Boolean(ltm[t.key])}
                            onCheckedChange={(v) => void patchLtm({ [t.key]: v } as Partial<ClaudeLtmConfig>)}
                          />
                        </div>
                      ))}
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Inject top N</div>
                            <p className="text-xs text-muted-foreground mt-1">
                              How many memories to inject into context at session start.
                            </p>
                          </div>
                          <span className="text-sm font-mono tabular-nums">{ltm.injectTopN}</span>
                        </div>
                        <Slider
                          value={[ltm.injectTopN]}
                          onValueChange={([v]) => setLtm({ ...ltm, injectTopN: v })}
                          onValueCommit={([v]) => void patchLtm({ injectTopN: v })}
                          min={1}
                          max={20}
                          step={1}
                          className="py-2"
                        />
                      </div>
                    </>
                  )}
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-medium">System Explorer</h2>
              {!explorer ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : (
                <div className="space-y-6">
                  {explorer.skills.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Skills ({explorer.skills.length})</h3>
                      <SkillsTab skills={explorer.skills} />
                    </div>
                  )}
                  {explorer.agents.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Agents ({explorer.agents.length})</h3>
                      <AgentsTab agents={explorer.agents} />
                    </div>
                  )}
                  {explorer.hooks.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Hooks ({explorer.hooks.length})</h3>
                      <HooksTab hooks={explorer.hooks} />
                    </div>
                  )}
                  {explorer.rules.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                      <h3 className="text-lg font-semibold text-foreground mb-4">Rules ({explorer.rules.length})</h3>
                      <RulesTab rules={explorer.rules} />
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillsTab({ skills }: { skills: SkillEntry[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.slashCommand?.toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <div className="space-y-4">
      <Input placeholder="Filter skills…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-lg bg-black/40 border-white/10 text-foreground" />
      <Accordion type="single" collapsible className="space-y-2">
        {filtered.map((s) => (
          <AccordionItem key={s.name} value={s.name} className="rounded-lg border border-white/10 px-4 bg-white/5 hover:bg-white/10 transition-colors border-b-0">
            <AccordionTrigger className="text-sm hover:no-underline py-3">
              <span className="flex items-center gap-2 flex-wrap text-left text-foreground">
                {s.name}
                {s.slashCommand && (
                  <Badge variant="outline" className="font-mono font-normal border-white/20 text-white">
                    {s.slashCommand}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              {s.triggerPhrases.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {s.triggerPhrases.map((t, i) => (
                    <Badge key={i} variant="secondary" className="font-normal bg-white/5">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[10px] font-mono text-muted-foreground opacity-50">{s.path}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No skills match.</p>
      )}
    </div>
  );
}

function AgentsTab({ agents }: { agents: AgentEntry[] }) {
  return (
    <Accordion type="single" collapsible className="space-y-2">
      {agents.map((a) => (
        <AccordionItem key={a.name} value={a.name} className="rounded-lg border border-white/10 px-4 bg-white/5 hover:bg-white/10 transition-colors border-b-0">
          <AccordionTrigger className="text-sm hover:no-underline py-3">
            <span className="flex items-center gap-2 text-left">
              <Badge variant="secondary" className="font-mono font-normal bg-white/10 text-white">
                {a.name}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{a.description || "—"}</p>
            {a.whenToUse && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">When to use</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{a.whenToUse}</p>
              </div>
            )}
            <p className="text-[10px] font-mono text-muted-foreground opacity-50">{a.path}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function HooksTab({ hooks }: { hooks: HookEntry[] }) {
  const grouped = useMemo(
    () =>
      hooks.reduce<Record<string, HookEntry[]>>((acc, h) => {
        (acc[h.event] ??= []).push(h);
        return acc;
      }, {}),
    [hooks],
  );

  if (hooks.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No hooks configured.</p>;
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([event, list]) => (
        <div key={event} className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono font-normal bg-white/10 text-white">
              {event}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {list.length} hook{list.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="rounded-lg border border-white/10 overflow-hidden bg-black/40">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/10">
                  <TableHead className="w-1/3">Matcher</TableHead>
                  <TableHead>Command / Script</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((h, i) => (
                  <TableRow key={i} className="border-white/5 hover:bg-white/5">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {h.matcher ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs" title={h.description}>
                      {h.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

function RulesTab({ rules }: { rules: RuleEntry[] }) {
  return (
    <Accordion type="single" collapsible className="space-y-2">
      {rules.map((r) => (
        <AccordionItem key={r.name} value={r.name} className="rounded-lg border border-white/10 px-4 bg-white/5 hover:bg-white/10 transition-colors border-b-0">
          <AccordionTrigger className="text-sm text-foreground hover:no-underline py-3">{r.name}</AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="max-h-96 overflow-y-auto custom-scrollbar pr-2">
              <MarkdownContent text={r.content} />
              <p className="text-[10px] font-mono text-muted-foreground opacity-50 mt-4">{r.path}</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Table2, Search, Archive, ArchiveRestore, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import type { CollectionRecords, CollectionSummary } from "@/lib/types";

function shortName(name: string): string {
  return name.split("/").pop() || name;
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [records, setRecords] = useState<CollectionRecords | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.collections();
      setCollections(list);
      setSelected((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const loadRecords = useCallback(async (id: number, q: string) => {
    setRecordsError(null);
    try {
      setRecords(await api.collectionRecords(id, q));
    } catch (err) {
      setRecords(null);
      setRecordsError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (selected === null) return;
    const t = setTimeout(() => void loadRecords(selected, text.trim()), 200);
    return () => clearTimeout(t);
  }, [selected, text, loadRecords]);

  const current = useMemo(() => collections.find((c) => c.id === selected) ?? null, [collections, selected]);

  async function toggleArchived() {
    if (!current) return;
    setBusy(true);
    try {
      await api.setCollectionArchived(current.id, current.status === "active");
      await loadCollections();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Collections</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Structured types your agents defined, and the records stored in them. Records are evidence, not permissions.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Table2 />
            </EmptyMedia>
            <EmptyTitle>No collections yet</EmptyTitle>
            <EmptyDescription>
              When an agent stores facts with a fixed shape (servers, releases, endpoints), it defines a collection with
              the collection tool. They show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Collections" className="space-y-1">
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (c.id !== selected) setText("");
                  setSelected(c.id);
                }}
                aria-current={c.id === selected ? "true" : undefined}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  c.id === selected ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{c.record_count}</span>
                </div>
                <div className="mt-1 flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
                  <span>{c.project_scope ? shortName(c.project_scope) : "global"}</span>
                  {c.status === "archived" && <Badge variant="outline" className="text-[10px] py-0">archived</Badge>}
                </div>
              </button>
            ))}
          </nav>

          {current && (
            <section aria-label={`Collection ${current.name}`} className="space-y-4 min-w-0">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{current.name}</h2>
                    <p className="text-sm text-muted-foreground">{current.description}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void toggleArchived()} disabled={busy}>
                    {current.status === "active" ? (
                      <><Archive className="w-4 h-4 mr-1" /> Archive</>
                    ) : (
                      <><ArchiveRestore className="w-4 h-4 mr-1" /> Restore</>
                    )}
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
                  <span>v{current.version}</span>
                  <span>·</span>
                  <span>{current.origin ?? "origin unknown"}</span>
                  {current.created_by && (<><span>·</span><span>by {current.created_by}</span></>)}
                  {current.key_field && (<><span>·</span><span>key: {current.key_field}</span></>)}
                  {current.indexes.length > 0 && (<><span>·</span><span>indexed: {current.indexes.join(", ")}</span></>)}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {current.fields.map((f) => (
                    <Badge key={f.name} variant="secondary" className="font-normal" title={f.description}>
                      {f.name}: {f.type === "enum" ? `enum(${(f.values ?? []).join("|")})` : f.type}
                      {f.required ? " *" : ""}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="relative max-w-sm">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  aria-label="Search records"
                  placeholder="Search records"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="pl-8"
                />
              </div>

              {recordsError ? (
                <p className="text-sm text-red-400">{recordsError}</p>
              ) : !records ? (
                <Skeleton className="h-32 w-full" />
              ) : records.count === 0 ? (
                <p className="text-sm text-muted-foreground">{text ? "No records match." : "No records yet."}</p>
              ) : (
                <div className="rounded-xl border border-white/10 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {current.fields.map((f) => (
                          <TableHead key={f.name}>{f.name}</TableHead>
                        ))}
                        <TableHead>origin</TableHead>
                        <TableHead>updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.records.map((r) => (
                        <TableRow key={r.id} className={r.status === "archived" ? "opacity-50" : undefined}>
                          {current.fields.map((f) => (
                            <TableCell key={f.name} className="max-w-[320px] truncate" title={cellText(r.data[f.name])}>
                              {cellText(r.data[f.name])}
                            </TableCell>
                          ))}
                          <TableCell className="text-xs whitespace-nowrap">
                            {r.authority_note && (
                              <ShieldAlert className="inline w-3.5 h-3.5 mr-1 text-amber-400" aria-label={r.authority_note}>
                                <title>{r.authority_note}</title>
                              </ShieldAlert>
                            )}
                            {r.origin ?? "unknown"}
                            {r.status === "archived" ? " · archived" : ""}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{new Date(r.updated_at.replace(" ", "T") + "Z").toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

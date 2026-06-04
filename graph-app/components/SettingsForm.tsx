"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import type { SettingsModels } from "@/lib/types";

interface Props {
  settings: Record<string, string>;
  models: SettingsModels;
  onSave: (settings: Record<string, string>) => Promise<void>;
  saving: boolean;
}

type KeyState = "idle" | "verifying" | "valid" | "invalid";

interface ProviderMeta {
  id: string;
  label: string;
  supportsEmbed: boolean;
  supportsLLM: boolean;
  apiKeyLabel: string;
  apiKeyKey: string | null;
  baseUrlKey?: string;
  embedModelKey?: string;
  llmModelKey?: string;
}

const PROVIDERS: ProviderMeta[] = [
  { id: "gemini", label: "Google Gemini", supportsEmbed: true, supportsLLM: true, apiKeyLabel: "Gemini API Key", apiKeyKey: "ltm.gemini.apiKey", embedModelKey: "ltm.gemini.embedModel", llmModelKey: "ltm.gemini.llmModel" },
  { id: "openai", label: "OpenAI", supportsEmbed: true, supportsLLM: true, apiKeyLabel: "OpenAI API Key", apiKeyKey: "ltm.openai.apiKey", embedModelKey: "ltm.openai.embedModel", llmModelKey: "ltm.openai.llmModel" },
  { id: "anthropic", label: "Anthropic", supportsEmbed: false, supportsLLM: true, apiKeyLabel: "Anthropic API Key", apiKeyKey: "ltm.anthropic.apiKey", llmModelKey: "ltm.anthropic.llmModel" },
  { id: "cohere", label: "Cohere", supportsEmbed: true, supportsLLM: true, apiKeyLabel: "Cohere API Key", apiKeyKey: "ltm.cohere.apiKey", embedModelKey: "ltm.cohere.embedModel", llmModelKey: "ltm.cohere.llmModel" },
  { id: "openrouter", label: "OpenRouter", supportsEmbed: true, supportsLLM: true, apiKeyLabel: "OpenRouter API Key", apiKeyKey: "ltm.openrouter.apiKey", embedModelKey: "ltm.openrouter.embedModel", llmModelKey: "ltm.openrouter.llmModel" },
  { id: "ollama", label: "Ollama (Local)", supportsEmbed: true, supportsLLM: true, apiKeyLabel: "Base URL", apiKeyKey: null, baseUrlKey: "ltm.ollama.baseUrl", embedModelKey: "ltm.ollama.embedModel", llmModelKey: "ltm.ollama.llmModel" },
];

function VerifyStatus({ state }: { state: KeyState }) {
  if (state === "verifying")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying…
      </span>
    );
  if (state === "valid")
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
        <Check className="w-3.5 h-3.5 text-[var(--accent)]" /> Connected
      </span>
    );
  if (state === "invalid")
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400">
        <X className="w-3.5 h-3.5" /> Invalid key
      </span>
    );
  return null;
}

function ModelSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition-colors disabled:opacity-50 appearance-none custom-select"
    >
      <option value="" disabled>{disabled ? "Verify API key to load models" : "Select a model"}</option>
      {options.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

function ProviderCard({
  meta,
  draft,
  models,
  keyState,
  roleLabels,
  onChange,
  onVerify,
}: {
  meta: ProviderMeta;
  draft: Record<string, string>;
  models: SettingsModels;
  keyState: KeyState;
  roleLabels: string[];
  onChange: (key: string, value: string) => void;
  onVerify: () => void;
}) {
  const isOllama = meta.id === "ollama";
  const verified = keyState === "valid" || isOllama;
  const keyFieldKey = isOllama ? meta.baseUrlKey! : meta.apiKeyKey!;
  const keyValue = draft[keyFieldKey] ?? "";
  const embedModels = models.embedModels?.[meta.id] ?? [];
  const llmModels = models.llmModels?.[meta.id] ?? [];
  const showEmbed = roleLabels.includes("Embed");
  const showLlm = roleLabels.includes("LLM");

  return (
    <div className="border border-dashed border-[var(--border)] rounded-[12px] bg-transparent p-6 space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-[var(--text-primary)]">{meta.label}</span>
          {roleLabels.map((r) => (
            <span key={r} className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest font-semibold rounded-[0px] border border-[var(--border)] bg-transparent text-[var(--text-primary)]">
              {r}
            </span>
          ))}
        </div>
        {!isOllama && <VerifyStatus state={keyState} />}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[var(--text-primary)]">{meta.apiKeyLabel}</label>
        <input
          type={isOllama ? "text" : "password"}
          value={keyValue}
          onChange={(e) => onChange(keyFieldKey, e.target.value)}
          onBlur={() => {
            if (!isOllama && keyValue.length > 0 && keyState === "idle") onVerify();
          }}
          onPaste={() => {
            if (!isOllama) setTimeout(onVerify, 50);
          }}
          placeholder={isOllama ? "http://localhost:11434" : "Paste key to verify…"}
          className="w-full font-mono bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
        />
        {keyState === "idle" && !isOllama && keyValue.length > 0 && (
          <button
            type="button"
            onClick={onVerify}
            className="text-xs text-[var(--accent)] hover:text-[var(--text-primary)] transition-colors mt-1 inline-block border-b border-[var(--accent)] hover:border-[var(--text-primary)]"
          >
            Verify connection →
          </button>
        )}
      </div>

      {showEmbed && meta.embedModelKey && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--text-primary)]">Embedding Model</label>
          <ModelSelect
            value={draft[meta.embedModelKey] ?? ""}
            options={embedModels}
            disabled={!verified || embedModels.length === 0}
            onChange={(v) => onChange(meta.embedModelKey!, v)}
          />
        </div>
      )}

      {showLlm && meta.llmModelKey && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--text-primary)]">LLM Model</label>
          <ModelSelect
            value={draft[meta.llmModelKey] ?? ""}
            options={llmModels}
            disabled={!verified || llmModels.length === 0}
            onChange={(v) => onChange(meta.llmModelKey!, v)}
          />
        </div>
      )}
    </div>
  );
}

const DECAY_FIELDS = [
  { key: "ltm.decay.graceDays", label: "Grace Period (days)", placeholder: "30" },
  { key: "ltm.decay.rate", label: "Decay Rate per Day", placeholder: "0.02" },
  { key: "ltm.decay.minConfidence", label: "Min Confidence (deprecation threshold)", placeholder: "0.2" },
];

const KEEPER_FIELDS = [
  { key: "ltm.promote.minImportance", label: "Promote Min Importance", placeholder: "3" },
  { key: "ltm.janitor.intervalMinutes", label: "Auto-run Interval (minutes, 0 = disabled)", placeholder: "0" },
];

export default function SettingsForm({ settings, models, onSave, saving }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [keyStates, setKeyStates] = useState<Record<string, KeyState>>({});
  const [liveModels, setLiveModels] = useState<Record<string, { embedModels: string[]; llmModels: string[] }>>({});
  const draftRef = useRef<Record<string, string>>(draft);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && Object.keys(settings).length > 0) {
      initialized.current = true;
      setDraft(settings);
      draftRef.current = settings;
      for (const meta of PROVIDERS) {
        if (!meta.apiKeyKey) continue;
        const storedKey = settings[meta.apiKeyKey] ?? "";
        if (storedKey.length >= 4) verifyProvider(meta.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      draftRef.current = next;
      return next;
    });
    setDirty(true);
  };

  const handleKeyChange = (providerId: string, key: string, value: string) => {
    handleChange(key, value);
    setKeyStates((prev) => ({ ...prev, [providerId]: "idle" }));
  };

  const verifyProvider = async (providerId: string) => {
    const meta = PROVIDERS.find((p) => p.id === providerId);
    if (!meta || !meta.apiKeyKey) return;
    const key = draftRef.current[meta.apiKeyKey] ?? "";
    if (key.length < 4) {
      setKeyStates((prev) => ({ ...prev, [providerId]: "invalid" }));
      return;
    }
    setKeyStates((prev) => ({ ...prev, [providerId]: "verifying" }));
    try {
      const res = await fetch("/api/settings/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, key }),
      });
      const result = (await res.json()) as {
        ok: boolean;
        error?: string;
        embedModels?: string[];
        llmModels?: string[];
      };
      setKeyStates((prev) => ({ ...prev, [providerId]: result.ok ? "valid" : "invalid" }));
      if (result.ok && (result.embedModels?.length || result.llmModels?.length)) {
        setLiveModels((prev) => ({
          ...prev,
          [providerId]: {
            embedModels: result.embedModels ?? [],
            llmModels: result.llmModels ?? [],
          },
        }));
      }
    } catch {
      setKeyStates((prev) => ({ ...prev, [providerId]: "invalid" }));
    }
  };

  const handleSave = async () => {
    await onSave(draft);
    setDirty(false);
  };

  const embedProvider = draft["ltm.embed.provider"] ?? "";
  const llmProvider = draft["ltm.llm.provider"] ?? "";
  const activeProviderIds = new Set([embedProvider, llmProvider]);
  const activeProviders = PROVIDERS.filter((p) => activeProviderIds.has(p.id));

  const getRoleLabels = (meta: ProviderMeta) => {
    const labels: string[] = [];
    if (meta.id === embedProvider) labels.push("Embed");
    if (meta.id === llmProvider) labels.push("LLM");
    return labels;
  };

  return (
    <div className="space-y-6">
      <div className="border border-dashed border-[var(--border)] rounded-[12px] bg-transparent p-6 space-y-5">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Provider Selection</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">Embedding Provider</label>
            <select
              value={embedProvider}
              onChange={(e) => handleChange("ltm.embed.provider", e.target.value)}
              className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition-colors appearance-none custom-select"
            >
              <option value="" disabled>Select provider</option>
              {models.embeddingProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">LLM Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => handleChange("ltm.llm.provider", e.target.value)}
              className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition-colors appearance-none custom-select"
            >
              <option value="" disabled>Select provider</option>
              {models.llmProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {activeProviders.map((meta) => {
        const live = liveModels[meta.id];
        const mergedModels: SettingsModels = {
          ...models,
          embedModels: {
            ...models.embedModels,
            ...(live?.embedModels.length ? { [meta.id]: live.embedModels } : {}),
          },
          llmModels: {
            ...models.llmModels,
            ...(live?.llmModels.length ? { [meta.id]: live.llmModels } : {}),
          },
        };
        return (
          <ProviderCard
            key={meta.id}
            meta={meta}
            draft={draft}
            models={mergedModels}
            keyState={keyStates[meta.id] ?? "idle"}
            roleLabels={getRoleLabels(meta)}
            onChange={(key, value) => handleKeyChange(meta.id, key, value)}
            onVerify={() => verifyProvider(meta.id)}
          />
        );
      })}

      <div className="border border-dashed border-[var(--border)] rounded-[12px] bg-transparent p-6 space-y-5">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Memory Decay</h3>
        <div className="space-y-4">
          {DECAY_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5 flex flex-col">
              <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
              <input
                value={draft[key] ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border border-dashed border-[var(--border)] rounded-[12px] bg-transparent p-6 space-y-5">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Auto-Promote &amp; Memory Keeper</h3>
        <div className="space-y-4">
          {KEEPER_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5 flex flex-col">
              <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
              <input
                value={draft[key] ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent border-b border-[var(--text-primary)] rounded-[0px] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => void handleSave()}
        disabled={!dirty || saving}
        className="w-full py-[14.4px] px-6 rounded-[36px] font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed
                   bg-[var(--node-memory)] text-[var(--text-primary)] hover:border-[var(--text-primary)] border border-transparent flex items-center justify-center gap-2"
      >
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save Configuration"
        )}
      </button>
    </div>
  );
}

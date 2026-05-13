/**
 * utils.ts — Shared helpers for all janitor providers.
 * Eliminates copy-paste of getApiKey / getModel patterns.
 */
import { getSetting } from "../../shared-db.js";
import { getDefault } from "./types.js";

/** Create a getter for an API key setting, with env-var fallback and missing-key error. */
export function makeApiKeyGetter(
  settingKey: string,
  envVar: string,
  providerName: string,
): () => string {
  return () => {
    const key = getSetting(settingKey) || process.env[envVar] || "";
    if (!key)
      throw new Error(
        `${providerName} API key not configured. Set it in Settings or ${envVar} env var.`,
      );
    return key;
  };
}

/** Create a getter for a model setting, with defaults fallback. */
export function makeModelGetter(settingKey: string): () => string {
  return () => getSetting(settingKey) || getDefault(settingKey);
}

/** Build the standard `{ ok: false, error }` result for a failed HTTP response. */
export async function httpErrorResult(
  res: Response,
): Promise<{ ok: false; error: string }> {
  const body = await res.text();
  return { ok: false, error: `${res.status}: ${body}` };
}

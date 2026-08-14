import { useCallback, useEffect, useState } from "react";

import type { EnvVarState } from "../../protocol";

export interface Env {
  vars: EnvVarState[] | null;
  error: string | null;
  saving: boolean;
  /** Returns the error message on failure, null on success. */
  save: (set: Record<string, string | null>) => Promise<string | null>;
  reset: () => Promise<string | null>;
}

async function post(body: unknown): Promise<EnvVarState[]> {
  const res = await fetch("/api/env", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await res.json()) as EnvVarState[] | { error?: string };
  if (!res.ok) {
    throw new Error(
      (Array.isArray(payload) ? undefined : payload.error) ?? `Request failed (${res.status})`,
    );
  }
  return payload as EnvVarState[];
}

/**
 * The environment as the server is willing to describe it. Values are redacted
 * before they are sent, so nothing here ever holds a secret — which is also why
 * saving replaces the whole list rather than patching a value locally.
 */
export function useEnv(): Env {
  const [vars, setVars] = useState<EnvVarState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/env")
      .then((res) => res.json() as Promise<EnvVarState[]>)
      .then((next) => live && setVars(next))
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const mutate = useCallback(async (body: unknown): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      setVars(await post(body));
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }, []);

  const save = useCallback((set: Record<string, string | null>) => mutate({ set }), [mutate]);
  const reset = useCallback(() => mutate({ reset: true }), [mutate]);

  return { error, reset, save, saving, vars };
}

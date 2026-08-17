import { useCallback, useState } from "react";

import type { InspectReport, ModelTestResult, ProbedModel } from "../../protocol";

export interface InspectCredentials {
  baseUrl: string;
  apiKey: string;
  /** Use the credentials the server already holds instead of the ones typed here */
  useSession: boolean;
}

/** Test state for one model, keyed by model id. */
export type ModelTests = Record<string, ModelTestResult | "running">;

export interface Inspection {
  report: InspectReport | null;
  error: string | null;
  loading: boolean;
  tests: ModelTests;
  inspect: (credentials: InspectCredentials) => Promise<void>;
  testModel: (model: ProbedModel) => Promise<void>;
  clear: () => void;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await res.json()) as T | { error?: string };
  if (!res.ok) {
    const message = (payload as { error?: string }).error;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return payload as T;
}

/**
 * Drives the provider inspection.
 *
 * The credentials used for the inspection are held so a later per-model test can
 * reuse them, and the key is deliberately not read back from the report — the
 * server only ever returns a redacted rendering of it.
 */
export function useInspect(): Inspection {
  const [report, setReport] = useState<InspectReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tests, setTests] = useState<ModelTests>({});
  const [used, setUsed] = useState<InspectCredentials | null>(null);

  const inspect = useCallback(async (credentials: InspectCredentials): Promise<void> => {
    setLoading(true);
    setError(null);
    // Results from the previous provider would be read as belonging to this one.
    setTests({});
    try {
      setReport(await post<InspectReport>("/api/inspect", credentials));
      setUsed(credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const testModel = useCallback(
    async (model: ProbedModel): Promise<void> => {
      if (used === null) return;
      setTests((prev) => ({ ...prev, [model.id]: "running" }));

      try {
        const result = await post<ModelTestResult>("/api/inspect/model", {
          ...used,
          // A model that must think will spend the whole test budget on it and
          // answer with nothing; asking for reasoning off keeps the sample useful.
          disableReasoning: model.hasReasoning,
          embedding: model.isEmbedding,
          model: model.id,
        });
        setTests((prev) => ({ ...prev, [model.id]: result }));
      } catch (err) {
        setTests((prev) => ({
          ...prev,
          [model.id]: {
            error: err instanceof Error ? err.message : String(err),
            latencyMs: 0,
            model: model.id,
            ok: false,
            route: model.isEmbedding ? "embeddings" : "chat",
            status: null,
          },
        }));
      }
    },
    [used],
  );

  const clear = useCallback((): void => {
    setReport(null);
    setError(null);
    setTests({});
  }, []);

  return { clear, error, inspect, loading, report, testModel, tests };
}

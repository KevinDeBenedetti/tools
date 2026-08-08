import type OpenAI from "openai";
import { DEFAULT_RETRIEVAL_CASES } from "./embed-tasks";
import { embedAll, type InputTypeVariant } from "./embeddings";
import { classifyError } from "./errors";
import type { ModelDef } from "./models";

// Retrieval quality for embedding models.
//
// The same principle as the chat quality suite: a deterministic assertion, no
// judge model. Each case pairs a query with one correct document and several
// hard negatives that share vocabulary with it. A usable embedding model ranks
// the correct document first; one that has merely learnt word overlap does not.
//
// The whole suite is embedded in a single batched request, so scoring a model
// costs one call — which matters when a free tier caps requests per day.

export interface RetrievalCase {
  id: string;
  query: string;
  /** The one document that actually answers the query */
  positive: string;
  /** Topically adjacent documents that must rank below the positive */
  negatives: string[];
}

export interface CaseResult {
  caseId: string;
  /** 1 when the positive ranked first */
  rank: number;
  passed: boolean;
  /** cos(query, positive) − best cos(query, negative); negative when it failed */
  margin: number;
}

export interface RetrievalResult {
  modelId: string;
  cases: CaseResult[];
  /** Fraction of cases where the correct document ranked first, 0..1 */
  precisionAt1: number;
  /** Mean reciprocal rank — partial credit for near misses */
  mrr: number;
  /** Mean separation between the positive and the best negative */
  meanMargin: number;
  dimensions: number;
  /** Whether returned vectors are unit-length, i.e. safe to dot-product directly */
  normalized: boolean;
  error?: string;
}

// ── Vector maths ───────────────────────────────────────────────────────────────

export function norm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/** Cosine similarity; 0 when either vector is degenerate. */
export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot / denom;
}

export function isNormalized(vectors: number[][], tolerance = 0.01): boolean {
  return vectors.every((v) => Math.abs(norm(v) - 1) <= tolerance);
}

// ── Scoring ────────────────────────────────────────────────────────────────────

/**
 * Score one case from its already-computed vectors: the query, the positive,
 * then the negatives in order.
 */
export function scoreCase(
  testCase: RetrievalCase,
  queryVec: number[],
  positiveVec: number[],
  negativeVecs: number[][],
): CaseResult {
  const positiveScore = cosine(queryVec, positiveVec);
  const negativeScores = negativeVecs.map((v) => cosine(queryVec, v));
  const bestNegative = negativeScores.length === 0 ? -1 : Math.max(...negativeScores);

  // Ties count against the model: an embedding that cannot separate the two is
  // not one you would deploy.
  const betterOrEqual = negativeScores.filter((s) => s >= positiveScore).length;

  return {
    caseId: testCase.id,
    margin: positiveScore - bestNegative,
    passed: betterOrEqual === 0,
    rank: betterOrEqual + 1,
  };
}

export function summarizeRetrieval(cases: CaseResult[]): {
  precisionAt1: number;
  mrr: number;
  meanMargin: number;
} {
  if (cases.length === 0) return { meanMargin: 0, mrr: 0, precisionAt1: 0 };
  return {
    meanMargin: cases.reduce((s, c) => s + c.margin, 0) / cases.length,
    mrr: cases.reduce((s, c) => s + 1 / c.rank, 0) / cases.length,
    precisionAt1: cases.filter((c) => c.passed).length / cases.length,
  };
}

// ── Runner ─────────────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  cases?: RetrievalCase[];
  timeoutMs: number;
  retries: number;
  dimensions?: number;
  /** Encode queries and documents asymmetrically, when the model accepts it */
  inputType?: InputTypeVariant;
}

/** Flatten a suite into the exact text order the vectors come back in. */
export function flattenCases(cases: RetrievalCase[]): string[] {
  return cases.flatMap((c) => [c.query, c.positive, ...c.negatives]);
}

/** The queries, one per case. */
export function queryTexts(cases: RetrievalCase[]): string[] {
  return cases.map((c) => c.query);
}

/** The documents, positives and negatives interleaved case by case. */
export function documentTexts(cases: RetrievalCase[]): string[] {
  return cases.flatMap((c) => [c.positive, ...c.negatives]);
}

function failed(modelId: string, error: string, dimensions = 0): RetrievalResult {
  return {
    cases: [],
    dimensions,
    error,
    meanMargin: 0,
    modelId,
    mrr: 0,
    normalized: false,
    precisionAt1: 0,
  };
}

export async function runRetrieval(
  client: OpenAI,
  model: ModelDef,
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const cases = options.cases ?? DEFAULT_RETRIEVAL_CASES;
  const queries = queryTexts(cases);
  const documents = documentTexts(cases);

  // Queries and documents go in separate batches so an asymmetric model can
  // tag each side correctly. Symmetric models get the same two batches with no
  // input_type — the split costs nothing and keeps one code path.
  const shared = {
    retries: options.retries,
    timeoutMs: options.timeoutMs,
    ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
  };

  let queryVecs: number[][];
  let documentVecs: number[][];
  try {
    const queryResult = await embedAll(client, model.id, queries, {
      ...shared,
      ...(options.inputType === undefined ? {} : { inputType: options.inputType.query }),
    });
    const documentResult = await embedAll(client, model.id, documents, {
      ...shared,
      ...(options.inputType === undefined ? {} : { inputType: options.inputType.document }),
    });
    queryVecs = queryResult.vectors;
    documentVecs = documentResult.vectors;
  } catch (err) {
    return failed(model.id, classifyError(err).message);
  }

  const dimensions = queryVecs[0]?.length ?? 0;
  if (queryVecs.length !== queries.length || documentVecs.length !== documents.length) {
    return failed(
      model.id,
      `expected ${queries.length}+${documents.length} vectors, got ${queryVecs.length}+${documentVecs.length}`,
      dimensions,
    );
  }

  const results: CaseResult[] = [];
  let docOffset = 0;
  for (const [index, testCase] of cases.entries()) {
    const positiveVec = documentVecs[docOffset]!;
    const negativeVecs = documentVecs.slice(
      docOffset + 1,
      docOffset + 1 + testCase.negatives.length,
    );
    results.push(scoreCase(testCase, queryVecs[index]!, positiveVec, negativeVecs));
    docOffset += 1 + testCase.negatives.length;
  }

  return {
    cases: results,
    dimensions,
    modelId: model.id,
    normalized: isNormalized([...queryVecs, ...documentVecs]),
    ...summarizeRetrieval(results),
  };
}

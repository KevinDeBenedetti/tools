// ── Did-you-mean suggestions ─────────────────────────────────────────────────────
//
// Small Levenshtein-based nearest-match used to suggest a command when the user
// mistypes one (e.g. "purge-tag" → "purge-tags").

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length]!;
}

/** Closest candidate to `target` within `maxDistance`, or undefined if none qualify. */
export function nearest(target: string, candidates: string[], maxDistance = 3): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best !== undefined && bestDistance <= maxDistance ? best : undefined;
}

/**
 * Label sync logic: ensure labels exist on GitHub repo
 */

import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { createLabel, repoSlug, updateLabel } from "./github";
import type { LabelDef, LabelsFile, TodoEntry } from "./types";
import { priorityLabels, statusLabels, typeLabels } from "./types";

export async function ensureLabel(def: LabelDef): Promise<void> {
  try {
    await createLabel(def.name, def.color, def.description);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
    await updateLabel(def.name, def.name, def.color, def.description);
  }
}

export async function ensureLabels(): Promise<void> {
  const labelsToSync = [
    ...Object.values(typeLabels),
    ...Object.values(statusLabels),
    ...Object.values(priorityLabels),
  ];

  for (const label of labelsToSync) {
    await ensureLabel(label);
  }
}

export function labelsForEntry(entry: TodoEntry): string[] {
  const labels: string[] = [];

  const typeLabel = typeLabels[entry.type];
  if (typeLabel) {
    labels.push(typeLabel.name);
  }

  const statusLabel = statusLabels[entry.status];
  if (statusLabel) {
    labels.push(statusLabel.name);
  }

  const priorityLabel = priorityLabels[entry.priority];
  if (priorityLabel) {
    labels.push(priorityLabel.name);
  }

  return labels;
}

// ── Custom labels from labels.yml ──────────────────────────────────────────────

export async function syncLabels(): Promise<void> {
  const labelsPath = process.env["LABELS_PATH"] ?? "labels.yml";
  if (!existsSync(labelsPath)) {
    console.log(`${labelsPath} not found — skipping label sync`);
    return;
  }

  const file = yaml.load(readFileSync(labelsPath, "utf8")) as LabelsFile;
  const defs = file.labels ?? [];
  console.log(`Syncing ${defs.length} labels to ${repoSlug()}…`);

  for (const def of defs) {
    try {
      await createLabel(def.name, def.color, def.description);
      console.log(`  created: ${def.name}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
      await updateLabel(def.name, def.name, def.color, def.description);
      console.log(`  updated: ${def.name}`);
    }
  }

  console.log("Label sync complete.");
}

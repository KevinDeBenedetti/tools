import color from "picocolors";

// ── ANSI-aware string width ────────────────────────────────────────────────────

export function ansiWidth(s: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed for ANSI stripping
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padEnd(s: string, w: number): string {
  const d = w - ansiWidth(s);
  return d > 0 ? s + " ".repeat(d) : s;
}

function padStart(s: string, w: number): string {
  const d = w - ansiWidth(s);
  return d > 0 ? " ".repeat(d) + s : s;
}

// ── Log helpers ────────────────────────────────────────────────────────────────

export const log = {
  success: (msg: string) => console.log(`  ${color.green("✓")} ${msg}`),
  error: (msg: string) => console.error(`  ${color.red("✗")} ${color.red(msg)}`),
  warn: (msg: string) => console.log(`  ${color.yellow("△")} ${msg}`),
  info: (msg: string) => console.log(`  ${color.cyan("○")} ${color.dim(msg)}`),
  step: (msg: string) => console.log(`  ${color.dim("→")} ${color.dim(msg)}`),
  blank: () => console.log(),
};

// ── Table ──────────────────────────────────────────────────────────────────────

export type Align = "left" | "right";

export interface Column {
  label: string;
  align?: Align;
}

export function table(columns: Column[], rows: string[][]): void {
  const widths = columns.map((col, i) => {
    const maxData = Math.max(0, ...rows.map((row) => ansiWidth(row[i] ?? "")));
    return Math.max(ansiWidth(col.label), maxData);
  });

  const bar = (l: string, m: string, r: string): string =>
    "  " + l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;

  const renderRow = (cells: string[], isHeader = false): string => {
    const cols = cells.map((cell, i) => {
      const w = widths[i]!;
      const align = columns[i]?.align ?? "left";
      const padded = align === "right" ? padStart(cell, w) : padEnd(cell, w);
      return ` ${isHeader ? color.bold(padded) : padded} `;
    });
    return `  │${cols.join("│")}│`;
  };

  console.log(bar("┌", "┬", "┐"));
  console.log(
    renderRow(
      columns.map((c) => c.label),
      true,
    ),
  );
  console.log(bar("├", "┼", "┤"));
  for (const row of rows) {
    console.log(renderRow(row));
  }
  console.log(bar("└", "┴", "┘"));
}

// ── Divider ────────────────────────────────────────────────────────────────────

export function divider(): void {
  console.log(`  ${color.dim("─".repeat(52))}`);
}

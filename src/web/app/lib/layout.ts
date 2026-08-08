// Where the output console sits. The split *sizes* are persisted by
// react-resizable-panels (useDefaultLayout); this only remembers which of the
// three arrangements you last chose.

export type Dock = "bottom" | "right" | "full";

const STORAGE_KEY = "tools-ui-dock";

export function readDock(): Dock {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "right" || stored === "full" ? stored : "bottom";
}

export function writeDock(dock: Dock): void {
  localStorage.setItem(STORAGE_KEY, dock);
}

/** Layout id for the panel sizes, so each arrangement keeps its own split. */
export function layoutId(dock: Dock): string {
  return `tools-ui-panels-${dock}`;
}

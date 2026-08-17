import {
  BotIcon,
  GaugeIcon,
  GitBranchIcon,
  ListTodoIcon,
  NetworkIcon,
  SearchIcon,
  ServerIcon,
  TerminalIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { CommandPanel } from "#components/command-panel";
import { EnvPanel } from "#components/env-panel";
import { InspectPanel } from "#components/inspect-panel";
import { ThemeToggle } from "#components/theme-toggle";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { ScrollArea } from "#components/ui/scroll-area";
import { Separator } from "#components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/ui/tooltip";
import { cn } from "#lib/utils";
import type { EnvVarState, WebGroup } from "../protocol";

const GROUP_ICONS: Record<string, typeof TerminalIcon> = {
  benchmark: GaugeIcon,
  copilot: BotIcon,
  github: GitBranchIcon,
  todo: ListTodoIcon,
};

interface Selection {
  group: string;
  command: string;
}

/** Which pane the main area is showing. Picking a command returns to "commands". */
type View = "commands" | "env" | "inspect";

function matches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || fields.some((f) => f.toLowerCase().includes(q));
}

/** Keeps only the commands matching the filter; a group name match keeps them all. */
function filterGroups(groups: WebGroup[], query: string): WebGroup[] {
  return groups
    .map((group) =>
      matches(query, group.name, group.description)
        ? group
        : {
            ...group,
            commands: group.commands.filter((c) => matches(query, c.name, c.description)),
          },
    )
    .filter((group) => group.commands.length > 0);
}

export function App(): JSX.Element {
  const [groups, setGroups] = useState<WebGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [view, setView] = useState<View>("commands");
  const [keyMissing, setKeyMissing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/commands")
      .then((res) => res.json() as Promise<WebGroup[]>)
      .then(setGroups)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // A missing API key is the most common reason a benchmark dies on its first
  // request. Finding that out from a badge beats finding it out from a stack of
  // failed runs — so the shell asks once, and again whenever the page is shown.
  useEffect(() => {
    if (view === "env") return;
    fetch("/api/env")
      .then((res) => res.json() as Promise<EnvVarState[]>)
      .then((vars) =>
        setKeyMissing(vars.some((v) => v.name === "OPENAI_API_KEY" && v.masked === null)),
      )
      .catch(() => setKeyMissing(false));
  }, [view]);

  // "/" focuses the filter, the way every search-first tool behaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => filterGroups(groups ?? [], query), [groups, query]);

  const command = useMemo(() => {
    if (!groups || !selected) return null;
    const group = groups.find((g) => g.name === selected.group);
    return group?.commands.find((c) => c.name === selected.command) ?? null;
  }, [groups, selected]);

  return (
    <TooltipProvider>
      <div className="grid h-screen grid-rows-[auto_1fr]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <TerminalIcon className="size-5" />
          <span className="font-semibold tracking-tight">tools</span>
          <span className="text-xs text-muted-foreground">local UI</span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={view === "inspect" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView((v) => (v === "inspect" ? "commands" : "inspect"))}
                  aria-pressed={view === "inspect"}
                >
                  <NetworkIcon />
                  API inspector
                </Button>
              </TooltipTrigger>
              <TooltipContent>Probe an AI endpoint and list its models</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={view === "env" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView((v) => (v === "env" ? "commands" : "env"))}
                  aria-pressed={view === "env"}
                >
                  <span className="relative">
                    <ServerIcon />
                    {keyMissing && (
                      <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-destructive" />
                    )}
                  </span>
                  Environment
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {keyMissing ? "No OPENAI_API_KEY set" : "Variables the commands will inherit"}
              </TooltipContent>
            </Tooltip>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[260px_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-muted/30">
            <div className="relative p-3">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                placeholder="Filter commands…"
                className="bg-background pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Separator />

            <ScrollArea className="min-h-0 flex-1">
              <nav className="p-2">
                {visible.map((group) => {
                  const Icon = GROUP_ICONS[group.name] ?? TerminalIcon;
                  return (
                    <section key={group.name} className="mb-3">
                      <h2 className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        <Icon className="size-3.5" />
                        {group.name}
                      </h2>
                      {group.commands.map((cmd) => {
                        const active =
                          view === "commands" &&
                          selected?.group === group.name &&
                          selected.command === cmd.name;
                        return (
                          <button
                            key={cmd.name}
                            type="button"
                            title={cmd.description}
                            onClick={() => {
                              setSelected({ command: cmd.name, group: group.name });
                              setView("commands");
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent hover:text-accent-foreground",
                            )}
                          >
                            <span className="truncate">{cmd.name}</span>
                            {cmd.destructiveFlag !== undefined && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className={cn(
                                      "ml-auto size-1.5 shrink-0 rounded-full",
                                      active ? "bg-primary-foreground/70" : "bg-destructive",
                                    )}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="right">Can delete things</TooltipContent>
                              </Tooltip>
                            )}
                          </button>
                        );
                      })}
                    </section>
                  );
                })}

                {groups !== null && visible.length === 0 && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No command matches “{query}”.
                  </p>
                )}
              </nav>
            </ScrollArea>
          </aside>

          <main className="min-h-0 overflow-hidden">
            {view === "env" ? (
              <EnvPanel />
            ) : view === "inspect" ? (
              <InspectPanel />
            ) : error !== null ? (
              <Centered>
                <p className="text-sm text-destructive">Could not load commands: {error}</p>
              </Centered>
            ) : groups === null ? (
              <Centered>
                <p className="text-sm text-muted-foreground">Loading commands…</p>
              </Centered>
            ) : selected && command ? (
              <CommandPanel
                key={`${selected.group}/${selected.command}`}
                group={selected.group}
                command={command}
              />
            ) : (
              <Centered>
                <TerminalIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Pick a command on the left.</p>
                <p className="text-xs text-muted-foreground/70">
                  Press <Kbd>/</Kbd> to filter, <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd> to run.
                </p>
              </Centered>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {children}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="mx-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

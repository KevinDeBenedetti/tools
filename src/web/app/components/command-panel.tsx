import {
  CheckIcon,
  CopyIcon,
  EraserIcon,
  Loader2Icon,
  Maximize2Icon,
  PanelBottomIcon,
  PanelRightIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";

import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "#components/ui/resizable";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/ui/tooltip";
import { type OutputChunk, type RunStatus, useRun } from "#hooks/use-run";
import { type Dock, layoutId, readDock, writeDock } from "#lib/layout";
import { cn } from "#lib/utils";
import { type FormValue, type FormValues, initialValues, previewCommand } from "../../args";
import type { WebCommand, WebFlag } from "../../protocol";

// ── Flag field ─────────────────────────────────────────────────────────────────

function asText(value: FormValue): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === undefined || value === false ? "" : String(value);
}

function placeholderFor(flag: WebFlag): string {
  if (flag.default !== undefined) return String(flag.default);
  if (flag.env !== undefined) return `$${flag.env}`;
  return flag.type === "string[]" ? "comma-separated" : "";
}

function FlagField({
  flag,
  value,
  onChange,
}: {
  flag: WebFlag;
  value: FormValue;
  onChange: (value: FormValue) => void;
}): JSX.Element {
  const id = `flag-${flag.name}`;

  if (flag.type === "boolean") {
    return (
      <div className="flex items-start gap-2.5 rounded-md border border-transparent p-1 transition-colors hover:border-border">
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <div className="grid gap-1">
          <Label htmlFor={id} className="font-mono text-[13px]">
            --{flag.kebab}
          </Label>
          <p className="text-xs leading-snug text-muted-foreground">{flag.description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5 p-1">
      <Label htmlFor={id} className="font-mono text-[13px]">
        --{flag.kebab}
        {flag.required && (
          <span className="text-destructive" aria-label="required">
            *
          </span>
        )}
        {flag.env !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="font-normal">
                env
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Falls back to ${flag.env}</TooltipContent>
          </Tooltip>
        )}
      </Label>
      <Input
        id={id}
        type={flag.type === "number" ? "number" : "text"}
        className="font-mono text-[13px]"
        value={asText(value)}
        placeholder={placeholderFor(flag)}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs leading-snug text-muted-foreground">{flag.description}</p>
    </div>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  exitCode,
}: {
  status: RunStatus;
  exitCode: number | null;
}): ReactNode {
  if (status === "running") {
    return (
      <Badge variant="secondary">
        <Loader2Icon className="animate-spin" />
        running
      </Badge>
    );
  }
  if (status === "done") return <Badge variant="success">exit 0</Badge>;
  if (status === "failed") {
    return <Badge variant="destructive">{exitCode === null ? "failed" : `exit ${exitCode}`}</Badge>;
  }
  return <Badge variant="outline">idle</Badge>;
}

// ── Dock switch ────────────────────────────────────────────────────────────────

const DOCKS: { value: Dock; icon: typeof PanelBottomIcon; label: string }[] = [
  { icon: PanelBottomIcon, label: "Output at the bottom", value: "bottom" },
  { icon: PanelRightIcon, label: "Output on the right", value: "right" },
  { icon: Maximize2Icon, label: "Output full screen", value: "full" },
];

function DockSwitch({
  dock,
  onChange,
}: {
  dock: Dock;
  onChange: (dock: Dock) => void;
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={dock}
      // Radix clears the value when the active item is pressed again; keeping
      // the current dock avoids a layout with nowhere to put the output.
      onValueChange={(value) => value !== "" && onChange(value as Dock)}
    >
      {DOCKS.map(({ value, icon: Icon, label }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={label}>
              <Icon />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

// ── Output console ─────────────────────────────────────────────────────────────

function Console({ output, status }: { output: OutputChunk[]; status: RunStatus }): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  // Follow the tail only while the reader is already at it, so scrolling back
  // to read an early line doesn't yank you forward on the next chunk.
  const stick = useRef(true);

  useEffect(() => {
    const el = viewport.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  const onScroll = (): void => {
    const el = viewport.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      ref={viewport}
      onScroll={onScroll}
      className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-muted/40 px-4 py-3 font-mono text-[12.5px] leading-relaxed"
    >
      {output.length === 0 ? (
        <p className="text-muted-foreground">
          {status === "running" ? "Waiting for output…" : "Output shows up here."}
        </p>
      ) : (
        <pre className="whitespace-pre-wrap break-words">
          {output.map((chunk, i) => (
            <span
              // Chunks are append-only, so the index is a stable identity here.
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
              key={i}
              className={chunk.type === "err" ? "text-destructive" : undefined}
            >
              {chunk.text}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export function CommandPanel({
  group,
  command,
}: {
  group: string;
  command: WebCommand;
}): JSX.Element {
  const [values, setValues] = useState<FormValues>(() => initialValues(command));
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dock, setDock] = useState<Dock>(() => readDock());
  const { status, exitCode, output, start, stop, clear } = useRun();

  // Panel sizes are persisted per arrangement, so the bottom split and the
  // right split each keep the width you last dragged them to.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: layoutId(dock) });

  const preview = previewCommand(group, command, values);
  const armed = command.destructiveFlag !== undefined && values[command.destructiveFlag] === true;

  const changeDock = (next: Dock): void => {
    setDock(next);
    writeDock(next);
  };

  const launch = useCallback(() => {
    setConfirming(false);
    void start(group, command.name, values);
  }, [start, group, command.name, values]);

  const submit = useCallback(() => {
    if (status === "running") return;
    if (armed) {
      setConfirming(true);
      return;
    }
    launch();
  }, [status, armed, launch]);

  // ⌘/Ctrl+Enter runs, matching the muscle memory of every other editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const copy = (): void => {
    void navigator.clipboard.writeText(preview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  // ── Panes ────────────────────────────────────────────────────────────────────

  const formPane = (
    <div className="@container/form h-full min-h-0 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold tracking-tight">
            <span className="text-muted-foreground">{group} / </span>
            {command.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{command.description}</p>
        </div>
        {command.destructiveFlag !== undefined && (
          <Badge variant="outline" className="shrink-0 border-destructive/40 text-destructive">
            <TriangleAlertIcon />
            destructive
          </Badge>
        )}
      </div>

      <div className="relative mt-5 overflow-x-auto rounded-lg border bg-muted/50 py-2.5 pr-12 pl-3">
        <code className="font-mono text-[13px] whitespace-nowrap">
          <span className="mr-1 text-muted-foreground select-none">$</span>
          {preview}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7"
          onClick={copy}
          aria-label="Copy command"
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
      </div>

      {command.flags.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Options
          </h2>
          {/* Container queries rather than viewport ones: what changes here is
              the pane's own width, as you dock or drag the console. */}
          <div className="grid gap-x-6 gap-y-4 @md/form:grid-cols-2 @4xl/form:grid-cols-3">
            {command.flags.map((flag) => (
              <FlagField
                key={flag.name}
                flag={flag}
                value={values[flag.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [flag.name]: v }))}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">This command takes no options.</p>
      )}
    </div>
  );

  const consolePane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container/bar flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {status === "running" ? (
          <Button variant="outline" size="sm" onClick={stop}>
            <SquareIcon />
            Stop
          </Button>
        ) : (
          <Button
            variant={armed ? "destructive" : "default"}
            size="sm"
            onClick={submit}
            title={armed ? "Runs for real — asks for confirmation first" : undefined}
          >
            <PlayIcon />
            {armed ? "Run (destructive)" : "Run"}
          </Button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setValues(initialValues(command))}
              aria-label="Reset options"
            >
              <RotateCcwIcon />
              <span className="hidden @lg/bar:inline">Reset</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset options to their defaults</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={output.length === 0}
              aria-label="Clear output"
            >
              <EraserIcon />
              <span className="hidden @lg/bar:inline">Clear</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear the output</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex items-center gap-2">
          <TerminalIcon className="hidden size-3.5 text-muted-foreground @md/bar:block" />
          <StatusBadge status={status} exitCode={exitCode} />
          <DockSwitch dock={dock} onChange={changeDock} />
        </div>
      </div>

      <Console output={output} status={status} />
    </div>
  );

  // ── Layout ───────────────────────────────────────────────────────────────────

  return (
    <>
      {dock === "full" ? (
        consolePane
      ) : (
        <ResizablePanelGroup
          // Remounting per arrangement lets each one restore its own sizes.
          key={dock}
          orientation={dock === "bottom" ? "vertical" : "horizontal"}
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="form" minSize="20%">
            {formPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="console" minSize="15%" defaultSize="40%">
            {consolePane}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-4 text-destructive" />
              Run a destructive command?
            </DialogTitle>
            <DialogDescription>
              <code className="font-mono">--{command.destructiveFlag}</code> is on, so this will
              make changes that cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <code
            className={cn(
              "block overflow-x-auto rounded-md border bg-muted/50 px-3 py-2",
              "font-mono text-[13px] whitespace-nowrap",
            )}
          >
            {preview}
          </code>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={launch}>
              Yes, run it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

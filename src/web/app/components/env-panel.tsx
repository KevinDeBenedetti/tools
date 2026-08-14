import {
  CheckIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";

import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import { Separator } from "#components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/ui/tooltip";
import { useEnv } from "#hooks/use-env";
import { cn } from "#lib/utils";
import type { EnvVarState } from "../../protocol";

// Known endpoints, so switching provider is a click rather than a URL to
// remember — getting this wrong is the single most common benchmark failure.
const PRESETS: { label: string; url: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Ollama", url: "http://localhost:11434/v1" },
];

const SOURCE_LABEL: Record<EnvVarState["source"], string> = {
  environment: "from .env",
  override: "set here",
  unset: "unset",
};

function SourceBadge({ source }: { source: EnvVarState["source"] }): JSX.Element {
  if (source === "override") return <Badge variant="secondary">{SOURCE_LABEL[source]}</Badge>;
  if (source === "environment") return <Badge variant="outline">{SOURCE_LABEL[source]}</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

function Value({ variable }: { variable: EnvVarState }): JSX.Element {
  if (variable.masked === null) {
    return <span className="text-muted-foreground italic">not set</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono break-all">{variable.masked}</span>
      {variable.secret && (
        <Tooltip>
          <TooltipTrigger asChild>
            <EyeOffIcon className="size-3 shrink-0 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            Redacted on the server — the value never reaches the browser
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// ── Override form ──────────────────────────────────────────────────────────────

function OverrideForm({
  vars,
  saving,
  onSave,
  onReset,
}: {
  vars: EnvVarState[];
  saving: boolean;
  onSave: (set: Record<string, string | null>) => Promise<string | null>;
  onReset: () => Promise<string | null>;
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  const find = (name: string): EnvVarState | undefined => vars.find((v) => v.name === name);
  const baseUrl = find("OPENAI_BASE_URL");
  const apiKey = find("OPENAI_API_KEY");
  const overridden = vars.some((v) => v.source === "override");
  const dirty = url.trim() !== "" || key.trim() !== "";

  const submit = async (): Promise<void> => {
    const set: Record<string, string | null> = {};
    if (url.trim() !== "") set["OPENAI_BASE_URL"] = url.trim();
    if (key.trim() !== "") set["OPENAI_API_KEY"] = key.trim();
    if (Object.keys(set).length === 0) return;

    const failure = await onSave(set);
    if (failure !== null) return;
    // The key is dropped from React state as soon as it is accepted: there is no
    // reason for the browser to keep holding it.
    setUrl("");
    setKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <KeyRoundIcon className="size-4" />
          Provider credentials
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to every command this UI runs, for as long as the server is up. Nothing is written
          to <code className="font-mono">.env</code>.
        </p>
      </div>

      <div className="grid gap-5 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="env-base-url" className="font-mono text-[13px]">
            OPENAI_BASE_URL
          </Label>
          <Input
            id="env-base-url"
            className="font-mono text-[13px]"
            placeholder={baseUrl?.masked ?? "https://api.openai.com/v1"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-xs text-muted-foreground">Presets:</span>
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setUrl(preset.url)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="env-api-key" className="font-mono text-[13px]">
            OPENAI_API_KEY
          </Label>
          <Input
            id="env-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
            placeholder={apiKey?.masked ?? "sk-…"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <p className="text-xs text-muted-foreground">
            Stored in the server's memory only, and never sent back to the browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void submit()}>
            {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            Apply
          </Button>

          {overridden && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => void onReset()}>
                  <RotateCcwIcon />
                  Clear overrides
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fall back to the environment the server started with</TooltipContent>
            </Tooltip>
          )}

          {saved && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckIcon className="size-3.5" />
              Applied
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export function EnvPanel(): JSX.Element {
  const { vars, error, saving, save, reset } = useEnv();

  if (error !== null && vars === null) {
    return <Centered>Could not read the environment: {error}</Centered>;
  }
  if (vars === null) {
    return <Centered>Reading the environment…</Centered>;
  }

  const missingKey = vars.find((v) => v.name === "OPENAI_API_KEY")?.source === "unset";

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="mx-auto grid max-w-3xl gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ServerIcon className="size-5" />
            Environment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the next command will inherit. Secrets are redacted before they leave the server.
          </p>
        </div>

        {missingKey && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">No API key</p>
              <p className="mt-0.5 text-muted-foreground">
                The benchmark commands will refuse to start. Set one below, or export{" "}
                <code className="font-mono">OPENAI_API_KEY</code> before launching the UI.
              </p>
            </div>
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <OverrideForm vars={vars} saving={saving} onSave={save} onReset={reset} />

        <section className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-medium">All variables</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Collected from the commands that declare them, plus the ones the CLI reads directly.
            </p>
          </div>

          <ul>
            {vars.map((variable, index) => (
              <li key={variable.name}>
                {index > 0 && <Separator />}
                <div className="grid gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      className={cn(
                        "font-mono text-[13px]",
                        variable.source === "unset" && "text-muted-foreground",
                      )}
                    >
                      {variable.name}
                    </code>
                    <SourceBadge source={variable.source} />
                    {variable.editable && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        editable
                      </Badge>
                    )}
                  </div>

                  <div className="text-[13px]">
                    <Value variable={variable} />
                  </div>

                  <p className="text-xs leading-snug text-muted-foreground">
                    {variable.description}
                  </p>

                  {variable.usedBy.length > 0 && (
                    <p className="text-xs text-muted-foreground/70">
                      Used by{" "}
                      <span className="font-mono">{variable.usedBy.slice(0, 4).join(", ")}</span>
                      {variable.usedBy.length > 4 && ` +${variable.usedBy.length - 4} more`}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

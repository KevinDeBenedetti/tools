import {
  BrainIcon,
  CheckIcon,
  CircleHelpIcon,
  GlobeIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  NetworkIcon,
  PlayIcon,
  RulerIcon,
  SearchIcon,
  SigmaIcon,
  TriangleAlertIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useMemo, useState } from "react";

import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import { Separator } from "#components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/ui/tooltip";
import { type ModelTests, useInspect } from "#hooks/use-inspect";
import { PRESETS } from "#lib/providers";
import { cn } from "#lib/utils";
import type {
  InspectReport,
  ModelTestResult,
  ProbedModel,
  ProbedRoute,
  RouteAccess,
  RouteVerdict,
} from "../../protocol";

// How many rows to put in the DOM at once. A large catalogue is ~350 models and
// each row carries badges and a button, so rendering the lot makes filtering
// feel broken. The rest is one click away.
const PAGE_SIZE = 60;

// ── Formatting ─────────────────────────────────────────────────────────────────

/** Prices span five orders of magnitude, so the precision has to follow. */
function formatPrice(perMillion: number): string {
  if (perMillion === 0) return "$0";
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}`;
  return `$${perMillion.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

// ── Verdict rendering ──────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<RouteVerdict, string> = {
  available: "available",
  error: "provider error",
  missing: "not implemented",
  "rate-limited": "rate limited",
  unauthorized: "key rejected",
  unreachable: "no answer",
};

function VerdictBadge({ route }: { route: ProbedRoute }): JSX.Element {
  const variant =
    route.verdict === "available"
      ? "success"
      : route.verdict === "missing"
        ? "outline"
        : route.verdict === "unauthorized" || route.verdict === "unreachable"
          ? "destructive"
          : "secondary";

  return (
    <Badge variant={variant} className={cn(route.verdict === "missing" && "text-muted-foreground")}>
      {VERDICT_LABEL[route.verdict]}
    </Badge>
  );
}

const ACCESS_HINT: Record<RouteAccess, string> = {
  private: "Answered 401/403 without a key — credentials are required",
  public: "Answered the same way with no key at all — this route is unauthenticated",
  unknown: "Not determined: the route is absent, or the second attempt never landed",
};

function AccessBadge({ access }: { access: RouteAccess }): JSX.Element {
  const Icon = access === "private" ? LockIcon : access === "public" ? GlobeIcon : CircleHelpIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1",
            access === "public" && "border-warning/40 text-warning",
            access === "unknown" && "text-muted-foreground",
          )}
        >
          <Icon />
          {access}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{ACCESS_HINT[access]}</TooltipContent>
    </Tooltip>
  );
}

// ── Connection form ────────────────────────────────────────────────────────────

function ConnectionForm({
  loading,
  onInspect,
}: {
  loading: boolean;
  onInspect: (baseUrl: string, apiKey: string, useSession: boolean) => void;
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [useSession, setUseSession] = useState(false);

  const ready = useSession || url.trim() !== "";
  const submit = (): void => {
    if (ready && !loading) onInspect(url.trim(), key.trim(), useSession);
  };

  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <KeyRoundIcon className="size-4" />
          Endpoint
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Any OpenAI-compatible base URL. The probe is read-only — it lists the catalogue and sends
          each route a deliberately invalid body, so no tokens are spent until you test a model.
        </p>
      </div>

      <div className="grid gap-5 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="inspect-url" className="font-mono text-[13px]">
            Base URL
          </Label>
          <Input
            id="inspect-url"
            className="font-mono text-[13px]"
            placeholder="https://openrouter.ai/api/v1"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
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
          <Label htmlFor="inspect-key" className="font-mono text-[13px]">
            API key
          </Label>
          <Input
            id="inspect-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
            placeholder="Leave empty to probe the endpoint unauthenticated"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <p className="text-xs text-muted-foreground">
            Used for this inspection and not stored. Nothing is written to{" "}
            <code className="font-mono">.env</code>, and the report carries only a redacted
            rendering of the key.
          </p>
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 accent-primary"
            checked={useSession}
            onChange={(e) => setUseSession(e.target.checked)}
          />
          <span>
            Use the session credentials instead — whatever{" "}
            <code className="font-mono">OPENAI_BASE_URL</code> /{" "}
            <code className="font-mono">OPENAI_API_KEY</code> the server is holding, so the provider
            the commands will actually use can be checked without retyping its key. Anything typed
            above still wins.
          </span>
        </label>

        <div>
          <Button size="sm" disabled={!ready || loading} onClick={submit}>
            {loading ? <Loader2Icon className="animate-spin" /> : <NetworkIcon />}
            {loading ? "Probing…" : "Inspect"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────────

function Stat({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function Summary({ report }: { report: InspectReport }): JSX.Element {
  const free = report.models.filter((m) => m.isFree).length;
  const embedding = report.models.filter((m) => m.isEmbedding).length;
  const truncated =
    report.totalCount !== undefined && report.totalCount > report.models.length
      ? report.totalCount
      : null;

  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Provider</h2>
        <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{report.baseUrl}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Models listed">
          {report.models.length}
          {truncated !== null && (
            <span className="ml-1 font-normal text-muted-foreground">of {truncated}</span>
          )}
        </Stat>
        <Stat label="Free">{free}</Stat>
        <Stat label="Embedding">{embedding}</Stat>
        <Stat label="Catalogue access">
          {report.authRequired === null ? (
            <span className="text-muted-foreground">unknown</span>
          ) : report.authRequired ? (
            <span className="inline-flex items-center gap-1">
              <LockIcon className="size-3.5" />
              key required
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-warning">
              <GlobeIcon className="size-3.5" />
              open
            </span>
          )}
        </Stat>
        <Stat label="Probed in">{(report.elapsedMs / 1000).toFixed(1)}s</Stat>
      </dl>

      <Separator />
      <p className="px-4 py-2.5 text-xs text-muted-foreground">
        {report.keyUsed === null ? (
          "Probed without credentials."
        ) : (
          <>
            Key <code className="font-mono">{report.keyUsed}</code>
            {report.keySource === "session" && " (from the server's environment)"}
          </>
        )}
      </p>
    </section>
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────────

function RoutesSection({ routes }: { routes: ProbedRoute[] }): JSX.Element {
  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Routes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each route is asked twice — once with the key, once without — so the access column
          reflects what the endpoint actually enforces rather than what it claims. A validation
          error counts as available: the route answered.
        </p>
      </div>

      <ul>
        {routes.map((route, index) => (
          <li key={`${route.method} ${route.path}`}>
            {index > 0 && <Separator />}
            <div className="grid gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {route.method}
                </Badge>
                <code className="font-mono text-[13px]">{route.path}</code>
                <VerdictBadge route={route} />
                <AccessBadge access={route.access} />
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  {route.status !== null && <span className="font-mono">{route.status}</span>}
                  <span>{route.latencyMs}ms</span>
                </span>
              </div>

              <p className="text-xs text-muted-foreground">{route.description}</p>

              {route.message !== undefined && (
                <p className="font-mono text-[11px] leading-snug break-words text-muted-foreground/70">
                  {route.message}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Models ─────────────────────────────────────────────────────────────────────

type SortKey = "id" | "price" | "context";

const FILTER_LABEL: Record<string, string> = {
  embedding: "Embedding",
  free: "Free",
  reasoning: "Reasoning",
  text: "Text-only",
};

function TestOutcome({ result }: { result: ModelTestResult }): JSX.Element {
  if (!result.ok) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <XIcon className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-words">
          {result.error ?? "Failed"}
          {result.status !== null && <span className="ml-1 font-mono">({result.status})</span>}
        </span>
      </p>
    );
  }

  return (
    <div className="grid gap-1 text-xs">
      <p className="flex items-center gap-1.5 text-success">
        <CheckIcon className="size-3.5 shrink-0" />
        Answered in {result.latencyMs}ms
        {result.dimensions !== undefined && ` — ${result.dimensions} dimensions`}
        {result.completionTokens !== undefined && ` — ${result.completionTokens} output tokens`}
      </p>
      {result.sample !== undefined && result.sample !== "" && (
        <p className="rounded bg-muted px-2 py-1 font-mono text-[11px] break-words">
          {result.sample}
        </p>
      )}

      {/* Shown as thinking, never as the answer — the model did not say this. */}
      {result.reasoningSample !== undefined && result.reasoningSample !== "" && (
        <div className="grid gap-0.5">
          <span className="flex items-center gap-1 text-muted-foreground">
            <BrainIcon className="size-3" />
            thinking
          </span>
          <p className="rounded border border-dashed px-2 py-1 font-mono text-[11px] break-words text-muted-foreground">
            {result.reasoningSample}
          </p>
        </div>
      )}

      {result.route === "chat" && result.sample === "" && (
        <p className="text-muted-foreground">
          {result.finishReason === "length"
            ? "The model hit the test's token budget before it finished answering."
            : "The model returned no text — a reasoning model can spend the whole budget thinking."}
        </p>
      )}
    </div>
  );
}

function ModelRow({
  model,
  test,
  onTest,
}: {
  model: ProbedModel;
  test: ModelTestResult | "running" | undefined;
  onTest: () => void;
}): JSX.Element {
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <code className="font-mono text-[13px] break-all">{model.id}</code>
          {model.label !== model.id && (
            <p className="text-xs text-muted-foreground">{model.label}</p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={test === "running"}
          onClick={onTest}
        >
          {test === "running" ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          Test
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {model.isFree && (
          <Badge variant="success" className="gap-1">
            <ZapIcon />
            free
          </Badge>
        )}
        {model.isEmbedding && (
          <Badge variant="secondary" className="gap-1">
            <SigmaIcon />
            embedding
          </Badge>
        )}
        {model.hasReasoning && (
          <Badge variant="outline" className="gap-1">
            <BrainIcon />
            reasoning
          </Badge>
        )}
        {!model.outputsTextOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-muted-foreground">
                {model.outputModalities.join(" + ") || "non-text"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Emits more than text — an image, audio or video generator
            </TooltipContent>
          </Tooltip>
        )}
        {model.moderated === true && (
          <Badge variant="outline" className="text-muted-foreground">
            moderated
          </Badge>
        )}
      </div>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {model.contextLength !== undefined && (
          <div className="flex items-center gap-1">
            <RulerIcon className="size-3" />
            <dt className="sr-only">Context</dt>
            <dd>{formatTokens(model.contextLength)} ctx</dd>
          </div>
        )}
        {model.maxCompletionTokens !== undefined && (
          <div>
            <dt className="sr-only">Max output</dt>
            <dd>{formatTokens(model.maxCompletionTokens)} max out</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Pricing per million tokens</dt>
          <dd>
            {model.pricingKnown ? (
              <>
                {formatPrice(model.inputPricePer1M)} in
                {!model.isEmbedding && ` / ${formatPrice(model.outputPricePer1M)} out`} per 1M
              </>
            ) : (
              <span className="italic">no pricing published</span>
            )}
          </dd>
        </div>
        {model.inputModalities.length > 0 && (
          <div>
            <dt className="sr-only">Input</dt>
            <dd>accepts {model.inputModalities.join(", ")}</dd>
          </div>
        )}
        {model.ownedBy !== undefined && model.ownedBy !== "" && (
          <div>
            <dt className="sr-only">Owner</dt>
            <dd>owned by {model.ownedBy}</dd>
          </div>
        )}
      </dl>

      {model.supportedParameters.length > 0 && (
        <p className="font-mono text-[11px] leading-snug text-muted-foreground/70">
          {model.supportedParameters.slice(0, 12).join(" · ")}
          {model.supportedParameters.length > 12 &&
            ` +${model.supportedParameters.length - 12} more`}
        </p>
      )}

      {test !== undefined && test !== "running" && <TestOutcome result={test} />}
    </div>
  );
}

function ModelsSection({
  report,
  tests,
  onTest,
}: {
  report: InspectReport;
  tests: ModelTests;
  onTest: (model: ProbedModel) => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("id");
  const [shown, setShown] = useState(PAGE_SIZE);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = report.models.filter(
      (m) => q === "" || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
    );

    if (filters.includes("free")) out = out.filter((m) => m.isFree);
    if (filters.includes("embedding")) out = out.filter((m) => m.isEmbedding);
    if (filters.includes("reasoning")) out = out.filter((m) => m.hasReasoning);
    if (filters.includes("text")) out = out.filter((m) => m.outputsTextOnly && !m.isEmbedding);

    // Sorting is on a copy: `report.models` is the server's list and other
    // sections count off it.
    return [...out].sort((a, b) => {
      if (sort === "price") return a.inputPricePer1M - b.inputPricePer1M;
      if (sort === "context") return (b.contextLength ?? 0) - (a.contextLength ?? 0);
      return a.id.localeCompare(b.id);
    });
  }, [report.models, query, filters, sort]);

  if (report.models.length === 0) {
    return (
      <section className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Models</h2>
        </div>
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {report.modelsError ?? "The provider listed no models."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border">
      <div className="grid gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            Models
            <span className="ml-2 font-normal text-muted-foreground">
              {visible.length} of {report.models.length}
            </span>
          </h2>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={sort}
            onValueChange={(value) => value !== "" && setSort(value as SortKey)}
          >
            <ToggleGroupItem value="id" className="px-2 text-xs">
              Name
            </ToggleGroupItem>
            <ToggleGroupItem value="price" className="px-2 text-xs">
              Cheapest
            </ToggleGroupItem>
            <ToggleGroupItem value="context" className="px-2 text-xs">
              Context
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter models…"
            className="pl-9 font-mono text-[13px]"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE_SIZE);
            }}
          />
        </div>

        <ToggleGroup
          type="multiple"
          size="sm"
          variant="outline"
          value={filters}
          onValueChange={(value) => {
            setFilters(value);
            setShown(PAGE_SIZE);
          }}
        >
          {Object.entries(FILTER_LABEL).map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="px-2 text-xs">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No model matches those filters.
        </p>
      ) : (
        <>
          <ul>
            {visible.slice(0, shown).map((model, index) => (
              <li key={model.id}>
                {index > 0 && <Separator />}
                <ModelRow model={model} test={tests[model.id]} onTest={() => onTest(model)} />
              </li>
            ))}
          </ul>

          {visible.length > shown && (
            <div className="border-t p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - shown)} more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export function InspectPanel(): JSX.Element {
  const { report, error, loading, tests, inspect, testModel } = useInspect();

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="mx-auto grid max-w-3xl gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <NetworkIcon className="size-5" />
            API inspector
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Point it at an OpenAI-compatible endpoint to see which routes it implements, whether
            they are guarded, and what its catalogue actually offers.
          </p>
        </div>

        <ConnectionForm
          loading={loading}
          onInspect={(baseUrl, apiKey, useSession) => void inspect({ apiKey, baseUrl, useSession })}
        />

        {error !== null && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="break-words">{error}</p>
          </div>
        )}

        {report !== null && (
          <>
            <Summary report={report} />

            {report.modelsError !== undefined && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="break-words">{report.modelsError}</p>
              </div>
            )}

            {report.routes.some((r) => r.access === "public") && (
              <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
                <GlobeIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>
                  Some routes answer without any credentials. That is normal for a local runtime —
                  and worth fixing for anything reachable from a network.
                </p>
              </div>
            )}

            <RoutesSection routes={report.routes} />
            <ModelsSection
              report={report}
              tests={tests}
              onTest={(model) => void testModel(model)}
            />
          </>
        )}
      </div>
    </div>
  );
}

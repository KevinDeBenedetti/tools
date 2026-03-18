import { ValidationError, toMessage } from "./errors";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type RunCommandOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export async function runCommand(
  cmd: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  if (exitCode !== 0 && !options.allowFailure) {
    throw new ValidationError(
      `Command failed: ${cmd.join(" ")}\n${stderr.trim() || stdout.trim()}`,
    );
  }

  return { exitCode, stderr, stdout };
}

export async function runGh(
  args: string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  return runCommand(["gh", ...args], options);
}

export async function runGhJson<T>(
  args: string[],
  options?: RunCommandOptions,
): Promise<T> {
  const result = await runGh(args, options);

  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new ValidationError(
      `Could not parse JSON output from: gh ${args.join(" ")}`,
      error,
    );
  }
}

export async function ensureGhAuth(): Promise<void> {
  await runGh(["auth", "status"]);
}

export function parseDuration(duration: string): Date {
  const match = /^(\d+)([dmyh])$/.exec(duration);
  if (!match) {
    throw new ValidationError(
      `Invalid duration format: ${duration}. Use format like "30d", "6m", "1y", or "12h".`,
    );
  }

  const amount = match[1];
  const unit = match[2];
  if (!amount || !unit) {
    throw new ValidationError(`Invalid duration format: ${duration}`);
  }

  const value = Number.parseInt(amount, 10);
  const now = new Date();

  switch (unit) {
    case "h":
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case "d":
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case "m": {
      const next = new Date(now);
      next.setMonth(next.getMonth() - value);
      return next;
    }
    case "y": {
      const next = new Date(now);
      next.setFullYear(next.getFullYear() - value);
      return next;
    }
    default:
      throw new ValidationError(`Invalid duration unit: ${unit}`);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = escapeRegex(pattern)
    .replaceAll("*", ".*")
    .replaceAll("?", ".");

  return new RegExp(`^${normalized}$`);
}

export function matchesPattern(value: string, pattern?: string): boolean {
  if (!pattern) {
    return true;
  }

  return globToRegExp(pattern).test(value);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

export function formatError(error: unknown): string {
  return toMessage(error);
}

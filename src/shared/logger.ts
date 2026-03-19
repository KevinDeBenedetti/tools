import * as core from "@actions/core";
import type { ILogger } from "./types/copilot";

/**
 * Logger backed by @actions/core — surfaces messages in the GitHub Actions UI.
 * Swap for ConsoleLogger in tests to avoid importing the actions SDK.
 */
export class ActionsLogger implements ILogger {
  info(msg: string): void {
    core.info(msg);
  }
  warn(msg: string): void {
    core.warning(msg);
  }
  error(msg: string): void {
    core.error(msg);
  }
  debug(msg: string): void {
    core.debug(msg);
  }
}

/** Lightweight logger for local dev / tests. */
export class ConsoleLogger implements ILogger {
  info(msg: string): void {
    console.log(`[INFO]  ${msg}`);
  }
  warn(msg: string): void {
    console.warn(`[WARN]  ${msg}`);
  }
  error(msg: string): void {
    console.error(`[ERROR] ${msg}`);
  }
  debug(msg: string): void {
    if (process.env["DEBUG"]) {
      console.log(`[DEBUG] ${msg}`);
    }
  }
}

/** No-op logger for tests that do not assert on log output. */
export class SilentLogger implements ILogger {
  info(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
  debug(_msg: string): void {}
}

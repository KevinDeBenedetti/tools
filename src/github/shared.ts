/**
 * GitHub CLI shared utilities — re-exported from src/shared/cli.ts for
 * backwards compatibility with the src/github/** import path.
 */
export {
  runCommand,
  runGh,
  runGhJson,
  ensureGhAuth,
  parseDuration,
  matchesPattern,
  globToRegExp,
  sleep,
  formatError,
} from "../shared/cli";

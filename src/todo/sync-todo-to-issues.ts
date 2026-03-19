/**
 * Sync TODO.yml entries to GitHub Issues via gh CLI.
 * Creates/updates/closes GitHub Issues based on TODO.yml entries.
 * This is a standalone script for use outside the main sync-todo entrypoint.
 * For full sync, prefer: bun run src/todo/sync-todo.ts push
 */

import { push } from "./issues";

push().catch((error) => {
  console.error(`Fatal: ${error}`);
  process.exit(1);
});

/**
 * File I/O helpers for TODO.yml
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import type { TodoFile } from "./types";

const TODO_PATH = process.env["TODO_PATH"] ?? "TODO.yml";

export function readTodo(): TodoFile {
  if (!existsSync(TODO_PATH)) {
    console.error(`${TODO_PATH} not found`);
    process.exit(1);
  }

  const content = readFileSync(TODO_PATH, "utf8");
  return yaml.load(content) as TodoFile;
}

export function writeTodo(data: TodoFile): void {
  const content = yaml.dump(data, { lineWidth: 120 });
  writeFileSync(TODO_PATH, content, "utf8");
}

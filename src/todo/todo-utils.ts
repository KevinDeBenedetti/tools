/**
 * Shared utilities for TODO.yml sync operations (legacy standalone scripts)
 */

import { readTodo as readTodoFile, writeTodo as writeTodoFile } from "./files";
import type { TodoFile, TodoStatus } from "./types";

export function readTodo(): TodoFile {
  return readTodoFile();
}

export function writeTodo(data: TodoFile): void {
  writeTodoFile(data);
}

export function mapStatus(githubState: string): TodoStatus {
  return githubState === "closed" ? "closed" : "open";
}

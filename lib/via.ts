import { AsyncLocalStorage } from "node:async_hooks";

// Marks events written while Aunt Tally carries out an action the person confirmed, so the shared
// history reads "… (via Aunt Tally)". Set it around the action; lib code adds viaMeta() to event data.
const store = new AsyncLocalStorage<{ via: string }>();

export function runVia<T>(via: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ via }, fn);
}

export function viaMeta(): { via?: string } {
  const via = store.getStore()?.via;
  return via ? { via } : {};
}

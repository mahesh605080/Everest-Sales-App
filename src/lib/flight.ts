/** Wraps an async job so that callers arriving while it runs all share the one run. Used for the token refresh. */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => (running ??= job().finally(() => { running = null; }));
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  for (let cause = err.cause; cause instanceof Error; cause = cause.cause) {
    parts.push(cause.message);
  }
  return parts.join(" — ");
}

const initialBackoffMs: number = 250;
const maximumBackoffMs: number = 30_000;

export function calculateRestartDelay(attempt: number, jitterPermille: number): number {
  const exponential: number = Math.min(maximumBackoffMs, initialBackoffMs * 2 ** attempt);
  return Math.min(maximumBackoffMs, Math.floor(exponential * (jitterPermille / 1_000)));
}

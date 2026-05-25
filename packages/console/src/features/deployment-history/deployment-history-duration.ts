export function formatDeploymentDuration(
  createdAt: string,
  completedAt: string | null,
  now: number = Date.now(),
): string {
  const startedAt: number = new Date(createdAt).getTime();
  const endedAt: number = completedAt === null ? now : new Date(completedAt).getTime();
  const totalSeconds: number = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours: number = Math.floor(minutes / 60);
  const remainingMinutes: number = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

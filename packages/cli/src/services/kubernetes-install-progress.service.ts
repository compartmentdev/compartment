import type {
  KubernetesInstallProgressAction,
  KubernetesInstallProgressDetail,
  KubernetesInstallProgressReporter,
} from './kubernetes-install-progress.types';

const installProgressHeartbeatMs: number = 5_000;

export async function runObservableInstallStep<TResult>(
  progress: KubernetesInstallProgressReporter | undefined,
  message: string,
  action: KubernetesInstallProgressAction<TResult>,
  readDetail?: KubernetesInstallProgressDetail<TResult>,
): Promise<TResult> {
  const startedAt: number = Date.now();
  progress?.report(`${message}\u2026`);
  const heartbeat: NodeJS.Timeout | undefined = startProgressHeartbeat(progress, message, startedAt);
  heartbeat?.unref();
  try {
    const result: TResult = await action();
    reportInstallCompletion(progress, message, startedAt, result, readDetail);
    return result;
  } finally {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
  }
}

function startProgressHeartbeat(
  progress: KubernetesInstallProgressReporter | undefined,
  message: string,
  startedAt: number,
): NodeJS.Timeout | undefined {
  return progress === undefined
    ? undefined
    : setInterval(
        (): void => progress.report(`${message}\u2026 ${formatElapsed(startedAt)} elapsed`),
        installProgressHeartbeatMs,
      );
}

function reportInstallCompletion<TResult>(
  progress: KubernetesInstallProgressReporter | undefined,
  message: string,
  startedAt: number,
  result: TResult,
  readDetail?: KubernetesInstallProgressDetail<TResult>,
): void {
  const detail: string | undefined = readDetail?.(result);
  const completion: string = `${message}\u2026 \u2713 ${formatElapsed(startedAt)}${detail === undefined ? '' : ` ${detail}`}`;
  progress?.report(completion, progress.mode === 'hidden' ? undefined : { renderMode: 'line' });
}

function formatElapsed(startedAt: number): string {
  return `${Math.max(0, Math.ceil((Date.now() - startedAt) / 1_000)).toString()}s`;
}

import type { KubeJobResult } from '@compartment/kube-runtime';
import type { RunWorkerBuildJobInput } from './worker-build-job.types';

export function shouldRetryWithPublicSeed(capture: KubeJobResult): boolean {
  return capture.preExecutionFailure === 'image-pull';
}

export async function publishSeedCacheFallback(input: RunWorkerBuildJobInput): Promise<void> {
  await input.onProgressLine?.({
    message: 'BuildKit seed cache is unavailable; falling back to the verified public seed image.',
    stream: 'stderr',
  });
}

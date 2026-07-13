import type pino from 'pino';
import type { WorkerConfig } from './config';
import type { KubeControllerHost } from './kube-controller-host';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError } from './logging/worker-error-log.types';

export async function runKubeControllerLoop(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  kubeController: KubeControllerHost,
): Promise<void> {
  for (;;) {
    try {
      if (!(await kubeController.reconcile())) {
        await waitForNextPoll(config.pollIntervalMs);
      }
    } catch (error) {
      logger.error(
        buildWorkerCaughtErrorLogPayload(error as WorkerCaughtError),
        'Kubernetes controller iteration failed.',
      );
      await waitForNextPoll(config.pollIntervalMs);
    }
  }
}

async function waitForNextPoll(pollIntervalMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, pollIntervalMs);
  });
}

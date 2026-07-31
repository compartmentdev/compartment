import { waitForAbortOrTimeout } from '@compartment/utils';
import type pino from 'pino';
import type { WorkerConfig } from './config';
import type { KubeControllerHost } from './kube-controller-host';
import { buildWorkerCaughtErrorLogPayload } from './logging/worker-error-log';
import type { WorkerCaughtError } from './logging/worker-error-log.types';

export async function runKubeControllerLoop(
  config: WorkerConfig,
  logger: pino.Logger<never, boolean>,
  kubeController: KubeControllerHost,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      if (!(await kubeController.reconcile())) {
        await waitForAbortOrTimeout(config.pollIntervalMs, signal);
      }
    } catch (error) {
      logger.error(
        buildWorkerCaughtErrorLogPayload(error as WorkerCaughtError),
        'Kubernetes controller iteration failed.',
      );
      await waitForAbortOrTimeout(config.pollIntervalMs, signal);
    }
  }
}

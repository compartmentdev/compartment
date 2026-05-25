import type { NodeConfig } from '../config';
import { reconcileRuntimeNetworks } from './runtime-network.service';

const runtimeNetworkStartupMaxAttempts: number = 20;
const runtimeNetworkStartupRetryDelayMs: number = 500;

interface StartupRuntimeNetworkLogPayload {
  attempt: number;
  maxAttempts: number;
}

interface StartupRuntimeNetworkLogger {
  warn(payload: StartupRuntimeNetworkLogPayload, message: string): void;
}

type WaitForRetry = (delayMs: number) => Promise<void>;

export async function reconcileRuntimeNetworksOnStartup(
  config: NodeConfig,
  logger: StartupRuntimeNetworkLogger,
  waitForRetry: WaitForRetry = waitForRetryDelay,
): Promise<void> {
  if (config.runtimeConnectivityMode !== 'network') {
    return;
  }

  await retryRuntimeNetworkReconciliation(config, logger, waitForRetry);
}

async function retryRuntimeNetworkReconciliation(
  config: NodeConfig,
  logger: StartupRuntimeNetworkLogger,
  waitForRetry: WaitForRetry,
): Promise<void> {
  for (let attempt: number = 1; attempt <= runtimeNetworkStartupMaxAttempts; attempt += 1) {
    const completed: boolean = await tryReconcileRuntimeNetworkAttempt(config, logger, waitForRetry, attempt);
    if (completed) {
      return;
    }
  }

  throw new Error('Node runtime-network reconciliation exhausted all startup retry attempts.');
}

async function tryReconcileRuntimeNetworkAttempt(
  config: NodeConfig,
  logger: StartupRuntimeNetworkLogger,
  waitForRetry: WaitForRetry,
  attempt: number,
): Promise<boolean> {
  try {
    await reconcileRuntimeNetworks(config);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !isRetryableStartupError(error)) {
      throw error;
    }
    if (attempt === runtimeNetworkStartupMaxAttempts) {
      warnStartupRuntimeNetworkReconcileSkipped(logger, attempt);
      return true;
    }

    logger.warn(
      { attempt, maxAttempts: runtimeNetworkStartupMaxAttempts },
      'Runtime network actors are not ready yet. Retrying node runtime-network reconciliation.',
    );
    await waitForRetry(runtimeNetworkStartupRetryDelayMs);

    return false;
  }
}

function warnStartupRuntimeNetworkReconcileSkipped(logger: StartupRuntimeNetworkLogger, attempt: number): void {
  logger.warn(
    { attempt, maxAttempts: runtimeNetworkStartupMaxAttempts },
    'Runtime network actors did not become ready during node startup. Runtime operations will reconcile networks on demand.',
  );
}

function isRetryableStartupError(error: Error): boolean {
  return error.message.includes('caddy container');
}

async function waitForRetryDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, delayMs);
  });
}

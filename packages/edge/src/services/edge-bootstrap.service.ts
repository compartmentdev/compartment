import type { AppAccessStateResponse } from '@compartment/contracts';
import { createCompartmentRequester, getAppAccessState, type CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import type { EdgeConfig } from '../config';
import type { EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import type { EdgeBootstrapFetchError } from './edge-bootstrap.service.types';

const edgeBootstrapRetryIntervalMs: number = 1_000;
const edgeAccessStateSyncIntervalMs: number = 5_000;

export async function bootstrapEdgeAccessStateUntilReady(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  logger: Logger,
): Promise<void> {
  for (;;) {
    try {
      await synchronizeEdgeAccessState(config, store);

      return;
    } catch (error) {
      if (!(error instanceof Error) || !isRetryableEdgeBootstrapError(error)) {
        throw error;
      }

      logger.warn({ err: error }, 'Edge startup dependency is not ready yet. Retrying.');
      await waitForEdgeBootstrapRetry();
    }
  }
}

export function startEdgeAccessStateRefreshLoop(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  logger: Logger,
): () => void {
  const interval: NodeJS.Timeout = setInterval((): void => {
    void synchronizeEdgeAccessState(config, store).catch(
      (error: Error | { message?: string } | null | undefined): void => {
        logger.error({ err: error }, readEdgeRefreshErrorMessage(error));
      },
    );
  }, edgeAccessStateSyncIntervalMs);

  return (): void => {
    clearInterval(interval);
  };
}

async function synchronizeEdgeAccessState(config: EdgeConfig, store: EdgeAppAccessStateStore): Promise<void> {
  const response: AppAccessStateResponse = await getAppAccessState(createEdgeRequester(config));
  if (response.state === null) {
    store.clearSnapshot();

    return;
  }

  store.replaceSnapshot(response.state);
}

function createEdgeRequester(config: EdgeConfig): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.edgeToken,
  });
}

function isRetryableEdgeBootstrapError(error: Error): boolean {
  return readEdgeBootstrapCauseCode(error) === 'ECONNREFUSED';
}

function readEdgeBootstrapCauseCode(error: Error): string | null {
  const fetchError: EdgeBootstrapFetchError = error as EdgeBootstrapFetchError;

  return typeof fetchError.cause?.code === 'string' ? fetchError.cause.code : null;
}

async function waitForEdgeBootstrapRetry(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, edgeBootstrapRetryIntervalMs);
  });
}

function readEdgeRefreshErrorMessage(error: Error | { message?: string } | null | undefined): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error?.message === 'string' ? error.message : 'Failed to synchronize edge access state.';
}

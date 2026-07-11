import {
  appAccessStateResponseSchema,
  type AppAccessStateResponse,
  type AppAccessStateSnapshot,
} from '@compartment/contracts';
import { createCompartmentRequester, getAppAccessState, type CompartmentRequester } from '@compartment/sdk';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { EdgeConfig } from '../config';
import type { EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import type {
  EdgeBootstrapFetchError,
  PersistedEdgeAccessStateEnvelope,
  PersistedEdgeAccessStateSnapshot,
} from './edge-bootstrap.service.types';

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

      // SPIKE-T7: API remains first choice; disk is consulted only after a retryable failure.
      if (await restoreFreshPersistedSnapshot(config, store, logger)) {
        return;
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
    // SPIKE-T7: null is authoritative and must not leave an older grant set recoverable.
    await rm(config.snapshotPath, { force: true });

    return;
  }

  // SPIKE-T7: persist before publishing in memory so the accepted state is restart-safe.
  await persistSnapshotAtomically(config.snapshotPath, response.state);
  store.replaceSnapshot(response.state);
}

const persistedSnapshotEnvelopeSchema: z.ZodType<PersistedEdgeAccessStateEnvelope> = z
  .object({
    persistedAt: z.string().datetime(),
    state: z.object({}).passthrough(),
  })
  .strict();

async function restoreFreshPersistedSnapshot(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  logger: Logger,
): Promise<boolean> {
  try {
    const persistedSnapshot: PersistedEdgeAccessStateSnapshot = await readPersistedSnapshot(config.snapshotPath);
    const ageMs: number = readSnapshotAgeMs(persistedSnapshot);
    if (!isSnapshotAgeAccepted(ageMs, config.snapshotMaxAgeMs)) {
      logger.warn({ ageMs, maxAgeMs: config.snapshotMaxAgeMs }, 'Persisted edge snapshot is outside its accepted age.');
      return false;
    }

    store.replaceSnapshot(persistedSnapshot.state);
    logger.warn({ ageMs }, 'SPIKE-T7 restored persisted last-known-good edge snapshot.');
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Persisted edge snapshot is unavailable or invalid.');
    return false;
  }
}

async function readPersistedSnapshot(snapshotPath: string): Promise<PersistedEdgeAccessStateSnapshot> {
  const rawSnapshot: string = await readFile(snapshotPath, 'utf8');
  const envelope: PersistedEdgeAccessStateEnvelope = persistedSnapshotEnvelopeSchema.parse(JSON.parse(rawSnapshot));
  const response: AppAccessStateResponse = appAccessStateResponseSchema.parse({ state: envelope.state });
  if (response.state === null) {
    throw new Error('Persisted edge snapshot state is null.');
  }

  return { persistedAt: envelope.persistedAt, state: response.state };
}

function readSnapshotAgeMs(snapshot: PersistedEdgeAccessStateSnapshot): number {
  return Date.now() - Date.parse(snapshot.persistedAt);
}

function isSnapshotAgeAccepted(ageMs: number, maxAgeMs: number): boolean {
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

async function persistSnapshotAtomically(snapshotPath: string, state: AppAccessStateSnapshot): Promise<void> {
  const snapshotDirectory: string = dirname(snapshotPath);
  const temporaryPath: string = `${snapshotPath}.${process.pid.toString()}.tmp`;
  const persistedSnapshot: PersistedEdgeAccessStateSnapshot = {
    persistedAt: new Date().toISOString(),
    state,
  };

  // SPIKE-T7: directory 0700 and file 0600; rename prevents partial JSON after a crash.
  await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
  await chmod(snapshotDirectory, 0o700);
  await writeFile(temporaryPath, JSON.stringify(persistedSnapshot), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, snapshotPath);
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

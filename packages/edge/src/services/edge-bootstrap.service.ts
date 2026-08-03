import {
  appAccessStateResponseSchema,
  type AppAccessStateResponse,
  type AppAccessStateSnapshot,
} from '@compartment/contracts';
import { createCompartmentRequester, getAppAccessState, type CompartmentRequester } from '@compartment/sdk';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { EdgeConfig } from '../config';
import type { EdgeAppAccessStateStore } from './app-access-state-store.service.types';
import type { EdgeSnapshotMetrics } from './edge-snapshot-metrics.service.types';
import type {
  EdgeBootstrapFetchError,
  PersistedEdgeAccessStateEnvelope,
  PersistedEdgeAccessStateSnapshot,
} from './edge-bootstrap.service.types';

const edgeBootstrapRetryIntervalMs: number = 1_000;
const edgeAccessStateSyncIntervalMs: number = 5_000;
const edgeRouteMissRefreshCooldownMs: number = 1_000;
type EdgeRefreshError = Error | { message?: string } | null | undefined;
const edgeRouteMissRefreshes: WeakMap<EdgeAppAccessStateStore, Promise<void>> = new WeakMap<
  EdgeAppAccessStateStore,
  Promise<void>
>();
const edgeRouteMissRefreshCompletedAt: WeakMap<EdgeAppAccessStateStore, number> = new WeakMap<
  EdgeAppAccessStateStore,
  number
>();

export async function bootstrapEdgeAccessStateUntilReady(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
  logger: Logger,
): Promise<void> {
  for (;;) {
    try {
      await synchronizeEdgeAccessState(config, store, metrics);

      return;
    } catch (error) {
      if (!(error instanceof Error) || !isRetryableEdgeBootstrapError(error)) {
        throw error;
      }

      if (await restoreFreshPersistedSnapshot(config, store, metrics, logger)) {
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
  metrics: EdgeSnapshotMetrics,
  logger: Logger,
): () => void {
  let stopped: boolean = false;
  let timer: NodeJS.Timeout = scheduleEdgeRefresh(refresh);

  async function refresh(): Promise<void> {
    try {
      await synchronizeEdgeAccessState(config, store, metrics);
    } catch (error) {
      metrics.recordRefreshError();
      logger.error({ err: error }, readEdgeRefreshErrorMessage(error as EdgeRefreshError));
    } finally {
      if (!stopped) {
        timer = scheduleEdgeRefresh(refresh);
      }
    }
  }

  return (): void => {
    stopped = true;
    clearTimeout(timer);
  };
}

export async function refreshEdgeAccessStateAfterRouteMiss(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
  logger: Logger,
): Promise<void> {
  const completedAt: number | undefined = edgeRouteMissRefreshCompletedAt.get(store);
  if (completedAt !== undefined && Date.now() - completedAt < edgeRouteMissRefreshCooldownMs) {
    return;
  }
  const activeRefresh: Promise<void> | undefined = edgeRouteMissRefreshes.get(store);
  if (activeRefresh !== undefined) {
    await activeRefresh;
    return;
  }

  await startEdgeRouteMissRefresh(config, store, metrics, logger);
}

async function startEdgeRouteMissRefresh(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
  logger: Logger,
): Promise<void> {
  const refresh: Promise<void> = synchronizeEdgeAccessState(config, store, metrics)
    .catch((error: EdgeRefreshError): void => {
      metrics.recordRefreshError();
      logger.error({ err: error }, readEdgeRefreshErrorMessage(error));
    })
    .finally((): void => {
      edgeRouteMissRefreshes.delete(store);
      edgeRouteMissRefreshCompletedAt.set(store, Date.now());
    });
  edgeRouteMissRefreshes.set(store, refresh);
  await refresh;
}

function scheduleEdgeRefresh(refresh: () => Promise<void>): NodeJS.Timeout {
  return setTimeout((): void => {
    void refresh();
  }, edgeAccessStateSyncIntervalMs);
}

async function synchronizeEdgeAccessState(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
): Promise<void> {
  const response: AppAccessStateResponse = await getAppAccessState(createEdgeRequester(config));
  if (response.state === null) {
    await applyAuthoritativeNull(config.snapshotPath, store, metrics);
    return;
  }

  await applyAuthoritativeSnapshot(config.snapshotPath, response.state, store, metrics);
}

async function applyAuthoritativeSnapshot(
  snapshotPath: string,
  state: AppAccessStateSnapshot,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
): Promise<void> {
  try {
    await persistSnapshotAtomically(snapshotPath, state);
  } catch (error) {
    metrics.recordPersistenceError();
    throw error;
  }
  store.replaceSnapshot(state);
  metrics.recordRestore('api');
}

async function applyAuthoritativeNull(
  snapshotPath: string,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
): Promise<void> {
  try {
    await persistSnapshotAtomically(snapshotPath, null);
    await rm(snapshotPath, { force: true });
  } catch (error) {
    metrics.recordPersistenceError();
    store.clearSnapshot();
    throw error;
  }
  store.clearSnapshot();
}

const persistedSnapshotEnvelopeSchema: z.ZodType<PersistedEdgeAccessStateEnvelope> = z
  .object({
    persistedAt: z.string().datetime(),
    state: z.union([z.object({}).passthrough(), z.null()]),
  })
  .strict();

async function restoreFreshPersistedSnapshot(
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  metrics: EdgeSnapshotMetrics,
  logger: Logger,
): Promise<boolean> {
  try {
    const persistedSnapshot: PersistedEdgeAccessStateSnapshot = await readPersistedSnapshot(config.snapshotPath);
    const ageMs: number = readSnapshotAgeMs(persistedSnapshot);
    if (!isSnapshotAgeAccepted(ageMs, config.snapshotMaxAgeMs)) {
      rejectSnapshotAge(ageMs, config.snapshotMaxAgeMs, metrics, logger);
      return false;
    }

    store.replaceSnapshot(persistedSnapshot.state);
    metrics.recordRestore('disk', persistedSnapshot.persistedAt);
    logger.warn({ ageMs }, 'Restored persisted last-known-good edge snapshot.');
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Persisted edge snapshot is unavailable or invalid.');
    return false;
  }
}

function rejectSnapshotAge(ageMs: number, maxAgeMs: number, metrics: EdgeSnapshotMetrics, logger: Logger): void {
  if (ageMs > maxAgeMs) {
    metrics.recordFailClosedExpiry();
  }
  logger.warn({ ageMs, maxAgeMs }, 'Persisted edge snapshot is outside its accepted age.');
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

async function persistSnapshotAtomically(snapshotPath: string, state: AppAccessStateSnapshot | null): Promise<void> {
  const snapshotDirectory: string = dirname(snapshotPath);
  const temporaryPath: string = `${snapshotPath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  const persistedSnapshot: PersistedEdgeAccessStateEnvelope = {
    persistedAt: new Date().toISOString(),
    state,
  };

  try {
    await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
    await chmod(snapshotDirectory, 0o700);
    await writeFile(temporaryPath, JSON.stringify(persistedSnapshot), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, snapshotPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch((): void => undefined);
    throw error;
  }
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

function readEdgeRefreshErrorMessage(error: EdgeRefreshError): string {
  return error instanceof Error ? error.message : (error?.message ?? 'Failed to synchronize edge access state.');
}

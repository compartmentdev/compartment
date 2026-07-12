import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance, RawServerDefault } from 'fastify';
import type { Logger } from 'pino';
import type { EdgeConfig } from './config';
import type { EdgeAppAccessStateStore } from './services/app-access-state-store.service.types';
import type { EdgeSnapshotMetrics } from './services/edge-snapshot-metrics.service.types';

declare module 'fastify' {
  interface FastifyInstance {
    edgeConfig: EdgeConfig;
    edgeStore: EdgeAppAccessStateStore;
    edgeSnapshotMetrics: EdgeSnapshotMetrics;
  }
}

export interface CreateEdgeAppOptions {
  config?: EdgeConfig | undefined;
}

export type EdgeApp = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse<IncomingMessage>, Logger>;

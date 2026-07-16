import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance, RawServerDefault } from 'fastify';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

import type { ApiConfig } from './config';
import type { Database } from './db/client';

export interface CreateAppOptions {
  closePool?: boolean | undefined;
  config?: ApiConfig;
  configureRuntime?: boolean | undefined;
  db?: Database;
  resourceOperationPool?: Pool;
  pool?: Pool;
}

export type ApiApp = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse<IncomingMessage>, Logger>;

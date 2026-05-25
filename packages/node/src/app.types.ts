import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance, RawServerDefault } from 'fastify';
import type { Logger } from 'pino';

import type { NodeConfig } from './config';

export interface CreateNodeAppOptions {
  config?: NodeConfig;
}

export type NodeApp = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse<IncomingMessage>, Logger>;

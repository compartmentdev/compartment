import pino from 'pino';
import type { WorkerConfig } from '../config';

export function createWorkerLogger(config: WorkerConfig): pino.Logger<never, boolean> {
  return pino({
    base: {
      service: 'worker',
    },
    level: config.logLevel,
  });
}

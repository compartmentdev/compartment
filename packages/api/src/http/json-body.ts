import type { JsonValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../app.types';

export function registerJsonBodyParsers(app: ApiApp): void {
  registerApplicationJsonBodyParser(app);
  registerApplicationGzipBodyParser(app);
}

function registerApplicationJsonBodyParser(app: ApiApp): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request: FastifyRequest, body: Buffer, done: (error: Error | null, value?: JsonValue) => void): void => {
      request.rawBody = body;
      if (body.length === 0) {
        done(null, null);
        return;
      }

      try {
        done(null, JSON.parse(body.toString('utf8')) as JsonValue);
      } catch (error) {
        done(error instanceof Error ? error : new Error('Failed to parse JSON body.'));
      }
    },
  );
}

function registerApplicationGzipBodyParser(app: ApiApp): void {
  app.addContentTypeParser(
    'application/gzip',
    { parseAs: 'buffer' },
    (_request: FastifyRequest, body: Buffer, done: (error: Error | null, value?: Buffer) => void): void => {
      done(null, body);
    },
  );
}

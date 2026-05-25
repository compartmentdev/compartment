import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../app.types';

type ParsedFormBody = Record<string, string>;

export function registerUrlEncodedFormBodyParser(app: ApiApp): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request: FastifyRequest, body: string, done: (error: Error | null, value?: ParsedFormBody) => void): void => {
      try {
        done(null, parseFormBody(body));
      } catch (error) {
        done(error instanceof Error ? error : new Error('Failed to parse form body.'));
      }
    },
  );
}

function parseFormBody(body: string): ParsedFormBody {
  const searchParams: URLSearchParams = new URLSearchParams(body);

  return Object.fromEntries(searchParams.entries());
}

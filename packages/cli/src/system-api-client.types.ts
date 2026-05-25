import type { JsonValue } from '@compartment/utils';

export interface SystemApiClientConfig {
  socketPath: string;
  token: string;
}

export interface SystemApiRequest<TResponse> {
  body?: object | undefined;
  idempotencyKey?: string | undefined;
  method: 'GET' | 'POST';
  parse: (value: JsonValue | null) => TResponse;
  path: string;
}

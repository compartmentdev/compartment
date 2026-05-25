import { request as requestHttp, type ClientRequest, type IncomingMessage } from 'node:http';
import { errorResponseSchema } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { SystemApiClientConfig, SystemApiRequest } from './system-api-client.types';

export async function requestSystemApi<TResponse>(
  config: SystemApiClientConfig,
  input: SystemApiRequest<TResponse>,
): Promise<TResponse> {
  const responseBody: string = await sendSystemApiRequest(config, input);
  const responseJson: JsonValue | null = responseBody === '' ? null : (JSON.parse(responseBody) as JsonValue);

  return input.parse(responseJson);
}

async function sendSystemApiRequest<TResponse>(
  config: SystemApiClientConfig,
  input: SystemApiRequest<TResponse>,
): Promise<string> {
  const bodyText: string | undefined = input.body === undefined ? undefined : JSON.stringify(input.body);

  return await new Promise<string>((resolve: (value: string) => void, reject: (reason?: Error) => void): void => {
    const request: ClientRequest = requestHttp(
      {
        headers: buildSystemHeaders(config.token, input.idempotencyKey, bodyText),
        method: input.method,
        path: input.path,
        socketPath: config.socketPath,
      },
      createSystemResponseHandler(resolve, reject),
    );
    request.on('error', reject);
    if (bodyText !== undefined) {
      request.write(bodyText);
    }
    request.end();
  });
}

function createSystemResponseHandler(
  resolve: (value: string) => void,
  reject: (reason?: Error) => void,
): (response: IncomingMessage) => void {
  return (response: IncomingMessage): void => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer | string): void => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    response.on('end', (): void => {
      handleSystemResponseEnd(response, chunks, resolve, reject);
    });
  };
}

function handleSystemResponseEnd(
  response: IncomingMessage,
  chunks: Buffer[],
  resolve: (value: string) => void,
  reject: (reason?: Error) => void,
): void {
  const responseText: string = Buffer.concat(chunks).toString('utf8');
  if (response.statusCode !== undefined && response.statusCode >= 400) {
    reject(new Error(readSystemApiErrorMessage(responseText)));
    return;
  }

  resolve(responseText);
}

function buildSystemHeaders(
  token: string,
  idempotencyKey: string | undefined,
  bodyText: string | undefined,
): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(bodyText === undefined
      ? {}
      : {
          'Content-Length': Buffer.byteLength(bodyText).toString(),
          'Content-Type': 'application/json',
        }),
    ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
  };
}

function readSystemApiErrorMessage(responseText: string): string {
  try {
    return errorResponseSchema.parse(JSON.parse(responseText)).error.message;
  } catch {
    return 'System API request failed.';
  }
}

import { request as createHttpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { assertHttpHeaderName, assertHttpHeaderValue, type JsonValue } from '@compartment/utils';
import { ZodError } from 'zod';
import type { NodeRuntimeClientOptions } from '../node-runtime-client.types';
import { NodeRequestError } from './node-request-error';
import type { NodeRequestMethod, NodeRequestOptions, NodeRequestSchema, NodeRequester } from './node-request.types';

interface NodeHttpResponse {
  payload: JsonValue;
  status: number;
}

interface SendNodeRequestInput {
  body: string | undefined;
  headers: Record<string, string>;
  method: NodeRequestMethod;
  path: string;
  socketPath: string;
  timeoutMs: number;
}

const defaultNodeRequestTimeoutMs: number = 330_000;

export function createNodeRequester(defaultOptions: NodeRuntimeClientOptions): NodeRequester {
  return async function request<TResult, TBody>({
    body,
    method,
    path,
    schema,
  }: NodeRequestOptions<TResult, TBody>): Promise<TResult> {
    const requestBody: string | undefined = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = createNodeRequestHeaders(requestBody, defaultOptions.internalToken);
    const response: NodeHttpResponse = await sendNodeRequest({
      body: requestBody,
      headers,
      method,
      path,
      socketPath: defaultOptions.nodeSocketPath,
      timeoutMs: readNodeRequestTimeoutMs(defaultOptions.requestTimeoutMs),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new NodeRequestError({ path, payload: response.payload, status: response.status });
    }

    return parseResponsePayload(response.payload, path, schema);
  };
}

function createNodeRequestHeaders(body: string | undefined, internalToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${internalToken}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body).toString();
  }

  assertNodeRequestHeaders(headers);
  return headers;
}

async function sendNodeRequest(input: SendNodeRequestInput): Promise<NodeHttpResponse> {
  assertHttpHeaderValue(input.path, 'node runtime request path');

  const options: RequestOptions = {
    headers: input.headers,
    method: input.method,
    path: input.path,
    socketPath: input.socketPath,
  };

  return await readNodeHttpResponse(input, options);
}

function assertNodeRequestHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    assertHttpHeaderName(name, 'node runtime header name');
    assertHttpHeaderValue(value, `node runtime ${name} header`);
  }
}

async function readNodeHttpResponse(input: SendNodeRequestInput, options: RequestOptions): Promise<NodeHttpResponse> {
  return await new Promise<NodeHttpResponse>(
    (resolve: (value: NodeHttpResponse) => void, reject: (reason?: Error) => void): void => {
      const request: ClientRequest = createHttpRequest(options, (response: IncomingMessage): void => {
        const chunks: Buffer<ArrayBufferLike>[] = [];
        response.on('data', (chunk: Buffer | string): void => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', (): void => {
          handleNodeHttpResponseEnd(chunks, input.path, response.statusCode ?? 0, resolve, reject);
        });
        response.on('error', (error: Error): void => {
          reject(createNodeRequestTransportError(input, error));
        });
      });

      request.setTimeout(input.timeoutMs, (): void => {
        request.destroy(createNodeRequestTimeoutError(input));
      });
      request.on('error', (error: Error): void => {
        reject(createNodeRequestTransportError(input, error));
      });
      writeNodeHttpRequest(request, input.body);
    },
  );
}

function handleNodeHttpResponseEnd(
  chunks: Buffer<ArrayBufferLike>[],
  path: string,
  status: number,
  resolve: (value: NodeHttpResponse) => void,
  reject: (reason?: Error) => void,
): void {
  try {
    resolve(createNodeHttpResponse(chunks, path, status));
  } catch (error) {
    reject(error instanceof Error ? error : new Error('Node runtime returned an invalid response.'));
  }
}

function readNodeRequestTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return defaultNodeRequestTimeoutMs;
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  throw new Error('Node runtime request timeout must be a positive number of milliseconds.');
}

function createNodeRequestTimeoutError(input: SendNodeRequestInput): Error {
  return new Error(
    `Node runtime request timed out for ${input.path} after ${input.timeoutMs}ms via socket ${input.socketPath}.`,
  );
}

function createNodeRequestTransportError(input: SendNodeRequestInput, error: Error): Error {
  if (error.message.startsWith('Node runtime request timed out for ')) {
    return error;
  }

  return new Error(`Node runtime request failed for ${input.path} via socket ${input.socketPath}: ${error.message}`);
}

function writeNodeHttpRequest(request: ClientRequest, body: string | undefined): void {
  if (body !== undefined) {
    request.write(body);
  }
  request.end();
}

function createNodeHttpResponse(chunks: Buffer<ArrayBufferLike>[], path: string, status: number): NodeHttpResponse {
  return {
    payload: readJsonPayload(Buffer.concat(chunks).toString('utf8'), path, status),
    status,
  };
}

function parseResponsePayload<TResult>(payload: JsonValue, path: string, schema: NodeRequestSchema<TResult>): TResult {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Node runtime returned an invalid response for ${path}.`);
    }

    throw error;
  }
}

function readJsonPayload(text: string, path: string, status: number): JsonValue {
  if (text === '') {
    return null;
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error(`Node runtime returned a non-JSON response for ${path} with status ${status}.`);
  }
}

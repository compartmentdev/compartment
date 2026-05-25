import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { createNodeRequester } from '../src/http/node-request';
import type { NodeRequester } from '../src/http/node-request.types';

type CreateHttpRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type RequestErrorListener = (error: Error) => void;

interface NodeRequestUnitMocks {
  createHttpRequest: Mock<CreateHttpRequest>;
}

interface MockClientRequestShape {
  end: () => ClientRequest;
  on: (event: string, listener: RequestErrorListener) => ClientRequest;
  setTimeout: (timeoutMs: number, callback: () => void) => ClientRequest;
}

interface MockIncomingMessageShape {
  on: (event: string, listener: (chunk?: Buffer) => void) => IncomingMessage;
  statusCode: number;
}

const mocks: NodeRequestUnitMocks = vi.hoisted(
  (): NodeRequestUnitMocks => ({
    createHttpRequest: vi.fn<CreateHttpRequest>(),
  }),
);

vi.mock('node:http', (): { request: Mock<CreateHttpRequest> } => ({
  request: mocks.createHttpRequest,
}));

beforeEach((): void => {
  mocks.createHttpRequest.mockReset();
});

describe('createNodeRequester transport defaults', (): void => {
  it('uses the deployment-safe default request timeout', async (): Promise<void> => {
    const request: MockClientRequestShape = createMockClientRequest();
    mocks.createHttpRequest.mockImplementationOnce(
      (_options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
        callback(createJsonResponse({ ok: true }));
        return request as ClientRequest;
      },
    );
    const nodeRequester: NodeRequester = createNodeRequester({
      internalToken: 'worker-secret',
      nodeSocketPath: '/tmp/compartment/test/node/agent.sock',
    });

    await expect(
      nodeRequester({
        method: 'GET',
        path: '/healthz',
        schema: z.object({ ok: z.literal(true) }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(request.setTimeout).toHaveBeenCalledWith(330_000, expect.any(Function));
  });
});

function createMockClientRequest(): MockClientRequestShape {
  const request: MockClientRequestShape = {
    end: vi.fn((): ClientRequest => request as ClientRequest),
    on: vi.fn((): ClientRequest => request as ClientRequest),
    setTimeout: vi.fn((): ClientRequest => request as ClientRequest),
  };
  return request;
}

function createJsonResponse(payload: object): IncomingMessage {
  const body: Buffer = Buffer.from(JSON.stringify(payload));
  const response: MockIncomingMessageShape = {
    statusCode: 200,
    on: vi.fn((event: string, listener: (chunk?: Buffer) => void): IncomingMessage => {
      if (event === 'data') {
        listener(body);
      }
      if (event === 'end') {
        listener();
      }
      return response as IncomingMessage;
    }),
  };
  return response as IncomingMessage;
}

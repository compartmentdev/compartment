import { vi } from 'vitest';

import type { FetchCall, FetchInput, FetchMockState } from './fetch-test.types';

function takeNextResponse(queuedResponses: Response[]): Response {
  const response: Response | undefined = queuedResponses.shift();

  if (response === undefined) {
    throw new Error('No mocked fetch response is available.');
  }

  return response;
}

export function createJsonResponse(payload: string | number | boolean | object | null, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  });
}

export function mockFetchSequence(responses: Response[]): FetchMockState {
  const queuedResponses: Response[] = [...responses];
  const calls: FetchCall[] = [];

  vi.stubGlobal('fetch', async function fetchMock(input: FetchInput, init?: RequestInit): Promise<Response> {
    calls.push({
      init,
      input,
    });

    return await Promise.resolve(takeNextResponse(queuedResponses));
  });

  return {
    calls,
  };
}

export function readRequestHeaders(call: FetchCall): Headers {
  return new Headers(call.init?.headers);
}

export function requireRequestBody(call: FetchCall): string {
  if (typeof call.init?.body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }
  return call.init.body;
}

export function readRequestUrl(call: FetchCall): string {
  if (typeof call.input === 'string') {
    return call.input;
  }

  if (call.input instanceof URL) {
    return call.input.toString();
  }

  return call.input.url;
}

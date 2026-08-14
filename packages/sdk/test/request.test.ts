import {
  createErrorResponse,
  installResponseSchema,
  organizationListResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  whoamiResponseSchema,
  type InstallRequest,
  type InstallResponse,
  type OrganizationListResponse,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientOptions } from '../src/client.types';
import {
  createCompartmentBinaryRequester,
  createCompartmentRequester,
  isRetryableRequestError,
} from '../src/http/request';
import {
  createTransportRequestError,
  isRetryableTransportRequestError,
  type RequestTransportFailure,
} from '../src/http/request-error';
import type {
  CompartmentBinaryRequester,
  CompartmentRequester,
  CompartmentRequestOptions,
} from '../src/http/request.types';
import { createJsonResponse, mockFetchSequence, readRequestHeaders, readRequestUrl } from './fetch-test-helpers';
import type { FetchCall, FetchInput, FetchMockState } from './fetch-test.types';
import type { ErrorResponsePayload, CompartmentRequestErrorShape } from './request.test.types';

interface TestAuthorizationRequestOptions extends CompartmentRequestOptions<OrganizationListResponse, undefined> {
  internalToken?: string | undefined;
}

function getFirstCall(calls: FetchCall[]): FetchCall {
  const firstCall: FetchCall | undefined = calls[0];

  if (firstCall === undefined) {
    throw new Error('Expected one fetch call.');
  }

  return firstCall;
}

afterEach((): void => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('compartment requester', (): void => {
  it('builds a POST request with default auth and organization headers', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example/',
      currentOrganization: 'acme-dev',
      sessionToken: 'session_123',
    };
    const body: InstallRequest = {
      adminEmail: 'admin@example.com',
      adminPassword: 'supersecretpassword',
      baseDomain: 'example.com',
      organizationName: 'Acme Dev',
      organizationSlug: 'acme-dev',
    };
    const responsePayload: InstallResponse = {
      adminEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dnsRecords: [
        {
          host: '*.example.com',
          purpose: 'Compartment control plane and hosted application entrypoints',
          type: 'A/AAAA-or-CNAME',
        },
      ],
      operation: {
        completedAt: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        id: 'op_123',
        status: 'queued',
        targetId: 'org_123',
        targetType: 'organization',
        type: 'compartment.install',
      },
      organization: {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      compartmentUrl: 'https://console.example.com',
      sessionToken: 'session_123',
    };
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(responsePayload)]);
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    const result: InstallResponse = await request<InstallResponse, InstallRequest>({
      body,
      method: 'POST',
      path: '/v1/install',
      schema: installResponseSchema,
    });

    expect(result.adminEmail).toBe('admin@example.com');

    const call: FetchCall = getFirstCall(fetchState.calls);
    const headers: Headers = readRequestHeaders(call);

    expect(readRequestUrl(call)).toBe('https://console.example/v1/install');
    expect(call.init?.body).toBe(JSON.stringify(body));
    expect(call.init?.method).toBe('POST');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer session_123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get(compartmentCurrentOrganizationHeaderName)).toBe('acme-dev');
  });

  it('omits optional headers and request body for a GET request', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      currentOrganization: '',
      sessionToken: '',
    };
    const responsePayload: OrganizationListResponse = {
      organizations: [],
    };
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(responsePayload)]);
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    await request<OrganizationListResponse, undefined>({
      method: 'GET',
      path: '/v1/orgs',
      schema: organizationListResponseSchema,
    });

    const call: FetchCall = getFirstCall(fetchState.calls);
    const headers: Headers = readRequestHeaders(call);

    expect(call.init?.body).toBeUndefined();
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.get(compartmentCurrentOrganizationHeaderName)).toBeNull();
  });

  it('preserves multipart form bodies without forcing the json content type', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      sessionToken: 'session_123',
    };
    const formData: FormData = new FormData();
    formData.set('descriptor', '{"name":"smoke-web"}');
    formData.set('sourceArchive', new Blob(['archive']), 'source.tgz');
    const responsePayload: InstallResponse = {
      adminEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dnsRecords: [
        {
          host: '*.example.com',
          purpose: 'Compartment control plane and hosted application entrypoints',
          type: 'A/AAAA-or-CNAME',
        },
      ],
      operation: {
        completedAt: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        id: 'op_123',
        status: 'queued',
        targetId: 'org_123',
        targetType: 'organization',
        type: 'compartment.install',
      },
      organization: {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      compartmentUrl: 'https://console.example.com',
      sessionToken: 'session_123',
    };
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(responsePayload)]);
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    await request<InstallResponse, FormData>({
      body: formData,
      method: 'POST',
      path: '/v1/install',
      schema: installResponseSchema,
    });

    const call: FetchCall = getFirstCall(fetchState.calls);
    const headers: Headers = readRequestHeaders(call);

    expect(call.init?.body).toBe(formData);
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('lets per-request auth and organization options override defaults', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      currentOrganization: 'default-org',
      sessionToken: 'default-session',
    };
    const responsePayload: OrganizationListResponse = {
      organizations: [],
    };
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(responsePayload)]);
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    await request<OrganizationListResponse, undefined>({
      currentOrganization: 'override-org',
      method: 'GET',
      path: '/v1/orgs',
      schema: organizationListResponseSchema,
      sessionToken: 'override-session',
    });

    const headers: Headers = readRequestHeaders(getFirstCall(fetchState.calls));

    expect(headers.get('Authorization')).toBe('Bearer override-session');
    expect(headers.get(compartmentCurrentOrganizationHeaderName)).toBe('override-org');
  });

  it('resolves authorization tokens by request and default precedence', async (): Promise<void> => {
    await expectAuthorizationHeader(
      {
        apiUrl: 'https://console.example',
        internalToken: 'default-internal',
        sessionToken: 'default-session',
      },
      {
        internalToken: 'request-internal',
        sessionToken: 'request-session',
      },
      'Bearer request-session',
    );
    await expectAuthorizationHeader(
      {
        apiUrl: 'https://console.example',
        internalToken: 'default-internal',
        sessionToken: 'default-session',
      },
      {
        internalToken: 'request-internal',
      },
      'Bearer default-session',
    );
    await expectAuthorizationHeader(
      {
        apiUrl: 'https://console.example',
        internalToken: 'default-internal',
      },
      {
        internalToken: 'request-internal',
      },
      'Bearer request-internal',
    );
    await expectAuthorizationHeader(
      {
        apiUrl: 'https://console.example',
        internalToken: 'default-internal',
      },
      {},
      'Bearer default-internal',
    );
  });

  it('attaches an abort signal when a request timeout is configured', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    };
    const fetchState: FetchMockState = mockFetchSequence([
      createJsonResponse({
        organizations: [],
      }),
    ]);
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    await request<OrganizationListResponse, undefined>({
      method: 'GET',
      path: '/v1/orgs',
      schema: organizationListResponseSchema,
    });

    expect(getFirstCall(fetchState.calls).init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws typed request errors for non-ok responses', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const errorPayload: ErrorResponsePayload = createErrorResponse('invalid_credentials', 'Invalid credentials.');
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([createJsonResponse(errorPayload, 401)]);

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompartmentRequestErrorShape>>({
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        name: 'CompartmentRequestError',
        statusCode: 401,
      }),
    );
  });

  it('throws a typed request error for empty non-ok responses', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([createTextResponse('', 502, { 'x-request-id': 'req_broker_123' })]);

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompartmentRequestErrorShape>>({
        code: 'request_error',
        message: 'GET https://console.example/v1/orgs failed with status 502 (request-id: req_broker_123).',
        name: 'CompartmentRequestError',
        requestId: 'req_broker_123',
        statusCode: 502,
        url: 'https://console.example/v1/orgs',
      }),
    );
  });

  it('throws a readable invalid response error for ok non-JSON responses', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([createTextResponse('not-json', 200)]);

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).rejects.toThrow('Compartment API returned an invalid response for /v1/orgs.');
  });

  it('throws a readable invalid response error for ok empty responses', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([createTextResponse('', 200)]);

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).rejects.toThrow('Compartment API returned an invalid response for /v1/orgs.');
  });

  it('parses JSON responses with a byte order mark', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const responsePayload: OrganizationListResponse = {
      organizations: [],
    };
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([createTextResponse(`\uFEFF${JSON.stringify(responsePayload)}`, 200)]);

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).resolves.toEqual(responsePayload);
  });

  it.each([401, 404])('does not retry binary GET responses with status %i', async (status: number): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const errorPayload: ErrorResponsePayload = createErrorResponse(
      'source_archive_not_found',
      'Source archive not found.',
    );
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester(defaults);
    let fetchCalls: number = 0;

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      fetchCalls += 1;
      return await Promise.resolve(createJsonResponse(errorPayload, status));
    });

    await expect(
      request({
        method: 'GET',
        path: '/internal/artifacts/artifact_123/source-archive',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompartmentRequestErrorShape>>({
        code: 'source_archive_not_found',
        message: `Source archive not found. GET https://console.example/internal/artifacts/artifact_123/source-archive failed after 1/4 attempts with status ${status.toString()} (code: source_archive_not_found).`,
        name: 'CompartmentRequestError',
        statusCode: status,
      }),
    );
    expect(fetchCalls).toBe(1);
  });

  it('throws typed request errors for unreadable non-ok binary responses', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester(defaults);

    mockFetchSequence([createUnreadableTextResponse(400)]);

    await expect(
      request({
        method: 'GET',
        path: '/internal/artifacts/artifact_123/source-archive',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompartmentRequestErrorShape>>({
        code: 'request_error',
        message:
          'GET https://console.example/internal/artifacts/artifact_123/source-archive failed after 1/4 attempts with status 400 (code: request_error).',
        name: 'CompartmentRequestError',
        statusCode: 400,
      }),
    );
  });

  it('retries a transient binary GET transport failure and returns the archive', async (): Promise<void> => {
    vi.useFakeTimers();
    const connectionError: Error = createFetchConnectionError('ECONNRESET');
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester({
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    });
    let fetchCalls: number = 0;

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        throw connectionError;
      }
      return await Promise.resolve(new Response('archive'));
    });

    const archivePromise: Promise<Buffer> = request({
      method: 'GET',
      path: '/internal/artifacts/artifact_123/source-archive',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).resolves.toEqual(Buffer.from('archive'));
    await vi.runAllTimersAsync();
    await archiveExpectation;
    expect(fetchCalls).toBe(2);
  });

  it('retries a 503 binary GET response and returns the archive', async (): Promise<void> => {
    vi.useFakeTimers();
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester({
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    });
    let fetchCalls: number = 0;

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      fetchCalls += 1;
      return await Promise.resolve(
        fetchCalls === 1
          ? createJsonResponse(createErrorResponse('internal_error', 'Temporary failure.'), 503)
          : new Response('archive'),
      );
    });

    const archivePromise: Promise<Buffer> = request({
      method: 'GET',
      path: '/internal/artifacts/artifact_123/source-archive',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).resolves.toEqual(Buffer.from('archive'));
    await vi.runAllTimersAsync();
    await archiveExpectation;
    expect(fetchCalls).toBe(2);
  });

  it('uses bounded exponential binary GET backoff with jitter', async (): Promise<void> => {
    vi.useFakeTimers();
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester({
      apiUrl: 'https://console.example',
    });
    const attemptTimes: number[] = [];

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      attemptTimes.push(Date.now());
      return await Promise.resolve(
        createJsonResponse(createErrorResponse('internal_error', 'Temporary failure.'), 503),
      );
    });

    const archivePromise: Promise<Buffer> = request({
      method: 'GET',
      path: '/internal/artifacts/artifact_123/source-archive',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).rejects.toMatchObject({
      statusCode: 503,
    });
    await vi.runAllTimersAsync();
    await archiveExpectation;
    expect(attemptTimes).toHaveLength(4);
    expect(readAttemptDelay(attemptTimes, 1)).toBeGreaterThanOrEqual(125);
    expect(readAttemptDelay(attemptTimes, 1)).toBeLessThanOrEqual(250);
    expect(readAttemptDelay(attemptTimes, 2)).toBeGreaterThanOrEqual(250);
    expect(readAttemptDelay(attemptTimes, 2)).toBeLessThanOrEqual(500);
    expect(readAttemptDelay(attemptTimes, 3)).toBeGreaterThanOrEqual(500);
    expect(readAttemptDelay(attemptTimes, 3)).toBeLessThanOrEqual(1_000);
  });

  it('reports sanitized retry exhaustion diagnostics with the nested transport code', async (): Promise<void> => {
    vi.useFakeTimers();
    const connectionError: Error = createFetchConnectionError('UND_ERR_CONNECT_TIMEOUT');
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester({
      apiUrl: 'https://user:secret@console.example',
      internalToken: 'internal-secret',
      requestTimeoutMs: 30_000,
    });
    let fetchCalls: number = 0;

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      await Promise.resolve();
      fetchCalls += 1;
      throw connectionError;
    });

    const archivePromise: Promise<Buffer> = request({
      method: 'GET',
      path: '/internal/artifacts/artifact_123/source-archive?token=query-secret',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).rejects.toMatchObject({
      message:
        'GET https://console.example/internal/artifacts/artifact_123/source-archive failed after 4/4 attempts: connection timed out; nested cause: TypeError; code: UND_ERR_CONNECT_TIMEOUT.',
    });
    await vi.runAllTimersAsync();
    await archiveExpectation;
    expect(fetchCalls).toBe(4);
  });

  it('retries a binary GET timeout with a fresh per-attempt signal', async (): Promise<void> => {
    vi.useRealTimers();
    const request: CompartmentBinaryRequester = createCompartmentBinaryRequester({
      apiUrl: 'https://console.example',
      requestTimeoutMs: 10,
    });
    const requestSignals: AbortSignal[] = [];
    let fetchCalls: number = 0;

    vi.stubGlobal('fetch', async (_input: FetchInput, init?: RequestInit): Promise<Response> => {
      fetchCalls += 1;
      if (init?.signal !== undefined && init.signal !== null) {
        requestSignals.push(init.signal);
      }
      if (fetchCalls === 1) {
        const response: Response = new Response('archive');
        const signal: AbortSignal | null | undefined = init?.signal;
        if (signal === undefined || signal === null) {
          throw new Error('Expected the binary GET to have an abort signal.');
        }
        vi.spyOn(response, 'arrayBuffer').mockImplementation(
          async (): Promise<ArrayBuffer> =>
            await new Promise<ArrayBuffer>((_resolve, reject): void => {
              const keepAliveTimer: NodeJS.Timeout = setTimeout((): void => undefined, 1_000);
              signal.addEventListener(
                'abort',
                (): void => {
                  clearTimeout(keepAliveTimer);
                  reject(createFetchAbortError());
                },
                { once: true },
              );
            }),
        );
        return response;
      }
      return await Promise.resolve(new Response('archive'));
    });

    const archivePromise: Promise<Buffer> = request({
      method: 'GET',
      path: '/internal/artifacts/artifact_123/source-archive',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).resolves.toEqual(Buffer.from('archive'));
    await archiveExpectation;
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0]).not.toBe(requestSignals[1]);
  });

  it('preserves the original transport error when no request timeout is configured', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const connectionError: Error = createFetchConnectionError('ECONNREFUSED');
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    vi.stubGlobal('fetch', async (): Promise<Response> => {
      await Promise.resolve();
      throw connectionError;
    });

    await expect(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
    ).rejects.toBe(connectionError);
  });

  it('normalizes timeout failures and preserves the original cause', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    };
    const timeoutError: Error = createFetchTimeoutError();
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    vi.stubGlobal('fetch', async (): Promise<Response> => await Promise.reject(timeoutError));

    await expectTransportRequestFailure(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
      'GET /v1/orgs timed out after 30 seconds. URL: https://console.example/v1/orgs.',
      timeoutError,
    );
  });

  it('normalizes connection failures and preserves the original cause', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    };
    const connectionError: Error = createFetchConnectionError('ECONNREFUSED');
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    vi.stubGlobal('fetch', async (): Promise<Response> => await Promise.reject(connectionError));

    await expectTransportRequestFailure(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
      'GET /v1/orgs failed: connection refused. URL: https://console.example/v1/orgs.',
      connectionError,
    );
  });

  it('normalizes closed socket failures and preserves the original cause', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
      requestTimeoutMs: 30_000,
    };
    const connectionError: Error = createFetchConnectionError('UND_ERR_SOCKET');
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    vi.stubGlobal('fetch', async (): Promise<Response> => await Promise.reject(connectionError));

    await expectTransportRequestFailure(
      request<OrganizationListResponse, undefined>({
        method: 'GET',
        path: '/v1/orgs',
        schema: organizationListResponseSchema,
      }),
      'GET /v1/orgs failed: connection closed. URL: https://console.example/v1/orgs.',
      connectionError,
    );
  });

  it('classifies retryable transport failures through normalized request errors', (): void => {
    expect(
      isRetryableTransportRequestError(
        createTransportRequestError(
          {
            method: 'GET',
            path: '/v1/orgs',
            requestTimeoutMs: 30_000,
          },
          createFetchConnectionError('ECONNREFUSED'),
        ),
      ),
    ).toBe(true);
    expect(isRetryableTransportRequestError(createFetchAbortError())).toBe(true);
    expect(
      isRetryableTransportRequestError(
        createTransportRequestError(
          {
            method: 'GET',
            path: '/v1/orgs',
            requestTimeoutMs: 30_000,
          },
          createFetchConnectionError('ENOTFOUND'),
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableTransportRequestError(
        createTransportRequestError(
          {
            method: 'GET',
            path: '/v1/orgs',
            requestTimeoutMs: 30_000,
          },
          createFetchTimeoutError(),
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableTransportRequestError(createWrappedTransportRequestError(createFetchConnectionError('ECONNRESET'), 4)),
    ).toBe(true);
    expect(
      isRetryableTransportRequestError(
        createWrappedTransportRequestError(createFetchConnectionError('UND_ERR_SOCKET'), 4),
      ),
    ).toBe(true);
  });

  it('treats overload answers as worth retrying and refusals as final', async (): Promise<void> => {
    mockFetchSequence([
      createJsonResponse(createErrorResponse('api_rate_limit_exceeded', 'Too many requests.'), 429),
      createJsonResponse(createErrorResponse('internal_error', 'Something broke.'), 503),
      createJsonResponse(createErrorResponse('email_taken', 'Already registered.'), 409),
    ]);
    const request: CompartmentRequester = createCompartmentRequester({ apiUrl: 'https://console.example' });

    expect(isRetryableRequestError(await captureRequestError(request))).toBe(true);
    expect(isRetryableRequestError(await captureRequestError(request))).toBe(true);
    expect(isRetryableRequestError(await captureRequestError(request))).toBe(false);
  });

  it('fails when the response body does not match the declared schema', async (): Promise<void> => {
    const defaults: ClientOptions = {
      apiUrl: 'https://console.example',
    };
    const request: CompartmentRequester = createCompartmentRequester(defaults);

    mockFetchSequence([
      createJsonResponse({
        principal: {
          id: 'prn_123',
        },
      }),
    ]);

    await expect(
      request({
        method: 'GET',
        path: '/v1/whoami',
        schema: whoamiResponseSchema,
      }),
    ).rejects.toThrow();
  });
});

async function captureRequestError(request: CompartmentRequester): Promise<Error> {
  try {
    await request<OrganizationListResponse, undefined>({
      method: 'GET',
      path: '/v1/orgs',
      schema: organizationListResponseSchema,
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error('Expected the request to fail.');
}

function readAttemptDelay(attemptTimes: number[], attempt: number): number {
  const attemptAt: number | undefined = attemptTimes[attempt];
  const previousAttemptAt: number | undefined = attemptTimes[attempt - 1];
  if (attemptAt === undefined || previousAttemptAt === undefined) {
    throw new Error(`Expected retry attempt ${attempt.toString()} to be recorded.`);
  }
  return attemptAt - previousAttemptAt;
}

async function expectTransportRequestFailure(
  promise: Promise<OrganizationListResponse>,
  expectedMessage: string,
  expectedCause: Error,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected the request to fail.');
  } catch (error) {
    const requestError: Error & { cause?: Error | undefined } = error as Error & { cause?: Error | undefined };

    expect(requestError.message).toBe(expectedMessage);
    expect(requestError.cause).toBe(expectedCause);
  }
}

async function expectAuthorizationHeader(
  defaults: ClientOptions,
  options: Pick<TestAuthorizationRequestOptions, 'internalToken' | 'sessionToken'>,
  expectedHeader: string,
): Promise<void> {
  const fetchState: FetchMockState = mockFetchSequence([
    createJsonResponse({
      organizations: [],
    }),
  ]);
  const request: CompartmentRequester = createCompartmentRequester(defaults);
  const requestOptions: TestAuthorizationRequestOptions = {
    method: 'GET',
    path: '/v1/orgs',
    schema: organizationListResponseSchema,
    ...options,
  };

  await request<OrganizationListResponse, undefined>(requestOptions);

  expect(readRequestHeaders(getFirstCall(fetchState.calls)).get('Authorization')).toBe(expectedHeader);
}

function createFetchTimeoutError(): Error {
  const error: Error = new Error('The request timed out.');
  error.name = 'TimeoutError';
  return error;
}

function createFetchAbortError(): Error {
  const error: Error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}

function createFetchConnectionError(code: string): Error {
  const error: Error = new TypeError('fetch failed');
  (error as Error & { cause?: { code?: string | undefined } | undefined }).cause = {
    code,
  };
  return error;
}

function createTextResponse(text: string, status: number, headers?: Record<string, string>): Response {
  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain',
      ...headers,
    },
    status,
  });
}

function createUnreadableTextResponse(status: number): Response {
  const response: Response = createTextResponse('unreadable', status);
  vi.spyOn(response, 'text').mockRejectedValue(new Error('read failed'));

  return response;
}

function createWrappedTransportRequestError(cause: RequestTransportFailure, count: number): Error {
  let currentCause: RequestTransportFailure = cause;

  for (let index: number = 0; index < count; index += 1) {
    currentCause = createTransportRequestError(
      {
        method: 'GET',
        path: '/v1/orgs',
        requestTimeoutMs: 30_000,
      },
      currentCause,
    );
  }

  if (!(currentCause instanceof Error)) {
    throw new Error('Expected wrapped transport failure to be an error.');
  }

  return currentCause;
}

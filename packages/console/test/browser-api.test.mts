import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { compartmentCsrfCookieName, compartmentCsrfHeaderName } from '@compartment/contracts/browser';
import { z } from 'zod';
import { requestBrowserApi, type BrowserApiError } from '../src/lib/browser-api';
import { browserQueryClient } from '../src/lib/browser-query-client';

describe('browser api client', (): void => {
  afterEach((): void => {
    browserQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it('preserves API error codes on failed unsafe requests', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'git_source_repository_access_denied',
            message: 'The selected GitHub App installation repositories could not be read.',
          },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestBrowserApi('/v1/example', z.object({}).strict(), { method: 'POST' })).rejects.toMatchObject({
      code: 'git_source_repository_access_denied',
      message: 'The selected GitHub App installation repositories could not be read.',
      name: 'BrowserApiError',
      status: 409,
    } satisfies Partial<BrowserApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('owns JSON serialization and unsafe request CSRF headers', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('document', { cookie: `${compartmentCsrfCookieName}=csrf-token` });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestBrowserApi('/v1/example', z.object({ ok: z.boolean() }).strict(), {
        json: { name: 'Acme' },
        method: 'POST',
      }),
    ).resolves.toEqual({ ok: true });

    const init: RequestInit | undefined = fetchMock.mock.calls[0]?.[1];
    const headers: Headers = new Headers(init?.headers);
    expect(init?.body).toBe(JSON.stringify({ name: 'Acme' }));
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get(compartmentCsrfHeaderName)).toBe('csrf-token');
  });

  it('keeps API transport outside TanStack state caches', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestBrowserApi('/v1/example', z.object({ ok: z.boolean() }).strict())).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(browserQueryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(browserQueryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('keeps same-path request signals isolated', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (): Promise<Response> => await Promise.resolve(new Response(JSON.stringify({ ok: true }))),
      );
    const firstAbortController: AbortController = new AbortController();
    const secondAbortController: AbortController = new AbortController();
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      requestBrowserApi('/v1/example', z.object({ ok: z.boolean() }).strict(), {
        signal: firstAbortController.signal,
      }),
      requestBrowserApi('/v1/example', z.object({ ok: z.boolean() }).strict(), {
        signal: secondAbortController.signal,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(firstAbortController.signal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(secondAbortController.signal);
  });
});

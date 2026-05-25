import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readPublicIpAddress } from '../src/public-ip';

type ReadFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface PublicIpTestMocks {
  fetch: Mock<ReadFetch>;
}

const mocks: PublicIpTestMocks = vi.hoisted(
  (): PublicIpTestMocks => ({
    fetch: vi.fn<ReadFetch>(),
  }),
);

describe('readPublicIpAddress', (): void => {
  beforeEach((): void => {
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach((): void => {
    mocks.fetch.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('skips invalid provider responses and returns the first valid IP address', async (): Promise<void> => {
    const publicIpv4Address: string = buildIpv4Address([8, 8, 8, 8]);
    mocks.fetch
      .mockResolvedValueOnce(new Response('<html>not-an-ip</html>', { status: 200 }))
      .mockResolvedValueOnce(new Response(`${publicIpv4Address}\n`, { status: 200 }));

    await expect(readPublicIpAddress()).resolves.toBe(publicIpv4Address);
    const firstCallOptions: RequestInit | undefined = mocks.fetch.mock.calls[0]?.[1];
    expect(firstCallOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips non-public reserved provider responses', async (): Promise<void> => {
    const publicIpv4Address: string = buildIpv4Address([8, 8, 8, 8]);
    mocks.fetch
      .mockResolvedValueOnce(new Response(`${buildIpv4Address([203, 0, 113, 10])}\n`, { status: 200 }))
      .mockResolvedValueOnce(new Response(`${publicIpv4Address}\n`, { status: 200 }));

    await expect(readPublicIpAddress()).resolves.toBe(publicIpv4Address);
  });

  it('aborts slow providers and falls back to the next IP service', async (): Promise<void> => {
    const publicIpv6Address: string = buildIpv6Address(['2606', '4700', '4700', '0', '0', '0', '0', '1111']);
    vi.useFakeTimers();
    mocks.fetch
      .mockImplementationOnce(createTimeoutFetch())
      .mockResolvedValueOnce(new Response(`${publicIpv6Address}\n`, { status: 200 }));

    const publicIpAddressPromise: Promise<string> = readPublicIpAddress();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(publicIpAddressPromise).resolves.toBe(publicIpv6Address);
  });

  it('fails with an explicit base-domain instruction when no valid public IP can be detected', async (): Promise<void> => {
    mocks.fetch
      .mockResolvedValueOnce(new Response('not-an-ip', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await expect(readPublicIpAddress()).rejects.toThrow(
      'Failed to detect a valid public IP address. Verify outbound internet access or pass --base-domain <domain>.',
    );
  });
});

function createTimeoutFetch(): ReadFetch {
  return async (_input: string, init?: RequestInit): Promise<Response> =>
    await new Promise<Response>((_resolve: (value: Response) => void, reject: (reason?: Error) => void): void => {
      const signal: AbortSignal | null = init?.signal instanceof AbortSignal ? init.signal : null;
      if (signal === null) {
        reject(new Error('Expected an AbortSignal timeout.'));
        return;
      }

      signal.addEventListener(
        'abort',
        (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('Timed out.'));
        },
        { once: true },
      );
    });
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv6Address(segments: readonly [string, string, string, string, string, string, string, string]): string {
  return segments.join(':');
}

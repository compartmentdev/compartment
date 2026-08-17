import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBuildSourceArchive } from '../src/build-source-archive-fetch';
import type { BuildSourceArchiveFetchRetryDiagnostic } from '../src/build-source-archive-fetch.types';

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchBuildSourceArchive', (): void => {
  it('converges after delayed build Pod connectivity without multiplying SDK retries', async (): Promise<void> => {
    vi.useFakeTimers();
    const diagnostics: BuildSourceArchiveFetchRetryDiagnostic[] = [];
    let fetchCalls: number = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      fetchCalls += 1;
      if (fetchCalls <= 8) {
        throw createFetchConnectionError('ECONNREFUSED');
      }
      return await Promise.resolve(new Response('archive'));
    });

    const archivePromise: Promise<Buffer> = fetchBuildSourceArchive({
      apiUrl: 'https://console.example',
      artifactId: 'artifact_123',
      onRetry: (diagnostic: BuildSourceArchiveFetchRetryDiagnostic): void => {
        diagnostics.push(diagnostic);
      },
      sourceArchiveCredential: 'scoped-credential',
    });
    const archiveExpectation: Promise<void> = expect(archivePromise).resolves.toEqual(Buffer.from('archive'));
    await vi.runAllTimersAsync();
    await archiveExpectation;

    expect(fetchCalls).toBe(9);
    expect(diagnostics.map(({ attempt, delayMs }) => ({ attempt, delayMs }))).toEqual([
      { attempt: 1, delayMs: 250 },
      { attempt: 2, delayMs: 500 },
      { attempt: 3, delayMs: 1_000 },
      { attempt: 4, delayMs: 2_000 },
      { attempt: 5, delayMs: 2_000 },
      { attempt: 6, delayMs: 2_000 },
      { attempt: 7, delayMs: 2_000 },
      { attempt: 8, delayMs: 2_000 },
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.diagnostic).toContain('ECONNREFUSED');
      expect(diagnostic.maximumAttempts).toBe(96);
      expect(diagnostic.target).toBe('/internal/artifacts/artifact_123/source-archive');
    }
  });

  it('reports bounded sanitized terminal diagnostics when connectivity never converges', async (): Promise<void> => {
    vi.useFakeTimers();
    let fetchCalls: number = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      await Promise.resolve();
      fetchCalls += 1;
      throw createFetchConnectionError('ECONNREFUSED');
    });

    const startedAtMs: number = Date.now();
    const archivePromise: Promise<Buffer> = fetchBuildSourceArchive({
      apiUrl: 'https://user:api-secret@console.example',
      artifactId: 'artifact_123',
      onRetry: (): void => undefined,
      sourceArchiveCredential: 'scoped-credential',
    });
    const failurePromise: Promise<Error> = readRejectedError(async (): Promise<void> => {
      await archivePromise;
    });
    await vi.runAllTimersAsync();
    const failure: Error = await failurePromise;

    expect(fetchCalls).toBeGreaterThan(8);
    expect(fetchCalls).toBeLessThan(96);
    expect(Date.now() - startedAtMs).toBeLessThanOrEqual(180_000);
    expect(failure.message).toMatch(
      /^Source archive fetch \/internal\/artifacts\/artifact_123\/source-archive failed after [0-9]+\/96 attempts within the 180 second budget: .*ECONNREFUSED\.$/u,
    );
    expect(failure.message).not.toContain('api-secret');
    expect(failure.message).not.toContain('scoped-credential');
  });

  it('does not retry after one request consumes the convergence budget', async (): Promise<void> => {
    vi.useFakeTimers();
    const startedAtMs: number = Date.now();
    let fetchCalls: number = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      await Promise.resolve();
      fetchCalls += 1;
      vi.setSystemTime(startedAtMs + 180_000);
      throw createFetchConnectionError('ECONNREFUSED');
    });

    const archivePromise: Promise<Buffer> = fetchBuildSourceArchive({
      apiUrl: 'https://console.example',
      artifactId: 'artifact_123',
      onRetry: (): void => undefined,
      sourceArchiveCredential: 'scoped-credential',
    });
    const failurePromise: Promise<Error> = readRejectedError(async (): Promise<void> => {
      await archivePromise;
    });
    const failure: Error = await failurePromise;

    expect(fetchCalls).toBe(1);
    expect(Date.now() - startedAtMs).toBe(180_000);
    expect(failure.message).toContain('failed after 1/96 attempts within the 180 second budget');
  });
});

function createFetchConnectionError(code: string): Error {
  const cause: Error & { code: string } = Object.assign(new Error('connect failed'), { code });
  return new TypeError('fetch failed', { cause });
}

async function readRejectedError(run: () => Promise<void>): Promise<Error> {
  try {
    await run();
  } catch (caughtError) {
    return caughtError instanceof Error ? caughtError : new Error(String(caughtError));
  }
  throw new Error('Expected operation to reject.');
}

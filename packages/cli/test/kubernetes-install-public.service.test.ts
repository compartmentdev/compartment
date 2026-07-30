import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForPublicControlPlane } from '../src/services/kubernetes-install-public.service';

describe('Kubernetes public control-plane readiness', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out with the observed HTTP response and recovery advice', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(new Response('', { status: 502 }))),
    );

    await expectReadinessFailure(
      'Public Compartment control plane at https://console.apps.example.com was not ready after 300s: HTTP 502 with location <none>',
    );
  });

  it('identifies an untrusted TLS chain separately from network failures', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          await failedFetch(
            new TypeError('fetch failed', {
              cause: Object.assign(new Error('self-signed certificate in certificate chain'), {
                code: 'SELF_SIGNED_CERT_IN_CHAIN',
              }),
            }),
          ),
      ),
    );

    await expectReadinessFailure(
      'TLS validation failed (SELF_SIGNED_CERT_IN_CHAIN): the certificate chain is not trusted by the Node.js CLI. Use a publicly trusted certificate, set NODE_EXTRA_CA_CERTS=/path/to/ca.crt, or run Node with NODE_OPTIONS=--use-openssl-ca',
    );
  });

  it('reports DNS reachability without describing it as a TLS failure', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          await failedFetch(
            new TypeError('fetch failed', {
              cause: Object.assign(new Error('getaddrinfo ENOTFOUND console.apps.example.com'), { code: 'ENOTFOUND' }),
            }),
          ),
      ),
    );

    await expectReadinessFailure('DNS resolution failed (ENOTFOUND) for the public control plane hostname');
  });

  it('reports a network timeout without describing it as a TLS failure', async (): Promise<void> => {
    vi.useFakeTimers();
    const timeout: Error = new Error('request timed out');
    timeout.name = 'TimeoutError';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await failedFetch(timeout)),
    );

    await expectReadinessFailure('network connection timed out before the public control plane responded');
  });
});

async function expectReadinessFailure(message: string): Promise<void> {
  const readiness: Promise<void> = waitForPublicControlPlane('https://console.apps.example.com');
  const failure: Promise<void> = expect(readiness).rejects.toThrow(message);
  await vi.advanceTimersByTimeAsync(300_000);
  await failure;
}

async function failedFetch(error: Error): Promise<Response> {
  return await Promise.reject(error);
}

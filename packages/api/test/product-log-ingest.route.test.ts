import { productLogIngestPathname, type ProductLogIngestEvent } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { deriveProductLogIngestToken } from '../src/routes/internal/product-log-ingest-token';
import type { ingestDeploymentProductLogs } from '../src/services/deployment-product-logs.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type IngestDeploymentProductLogs = typeof ingestDeploymentProductLogs;
const ingestMock: Mock<IngestDeploymentProductLogs> = vi.hoisted((): Mock<IngestDeploymentProductLogs> => vi.fn());

vi.mock('../src/services/deployment-product-logs.service', (): { ingestDeploymentProductLogs: Mock } => ({
  ingestDeploymentProductLogs: ingestMock,
}));

const event: ProductLogIngestEvent = {
  containerName: 'app-dep-123',
  message: 'ready',
  namespace: 'cpt-project',
  podName: 'app-deployment-abc',
  podUid: '11111111-1111-4111-8111-111111111111',
  restartIdentity: '0',
  sourceFingerprint: 'a'.repeat(64),
  sourceOffset: 17,
  stream: 'stdout',
  timestamp: '2026-07-12T10:00:00.000Z',
};

describe('product log ingest route', (): void => {
  afterEach((): void => {
    ingestMock.mockReset();
  });

  it('rejects the broad worker credential and accepts only the derived ingest credential', async (): Promise<void> => {
    applyApiRouteTestEnv();
    ingestMock.mockResolvedValueOnce({ accepted: 1, duplicates: 0, rejected: 0 });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const workerResponse: LightMyRequestResponse = await postLogs(app, 'test-runtime-control-token');
      const ingestResponse: LightMyRequestResponse = await postLogs(
        app,
        deriveProductLogIngestToken('test-runtime-control-token'),
      );
      expect(workerResponse.statusCode).toBe(401);
      expect(ingestResponse.statusCode).toBe(200);
      expect(ingestMock).toHaveBeenCalledWith([event]);
    });
  });

  it('returns a retryable response while Pod identity persistence is racing', async (): Promise<void> => {
    applyApiRouteTestEnv();
    ingestMock.mockResolvedValueOnce({ accepted: 0, duplicates: 0, rejected: 1 });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await postLogs(
        app,
        deriveProductLogIngestToken('test-runtime-control-token'),
      );
      expect(response.statusCode).toBe(503);
    });
  });
});

async function postLogs(app: ApiApp, token: string): Promise<LightMyRequestResponse> {
  return await injectApiRoute(app, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    method: 'POST',
    payload: JSON.stringify([event]),
    timeoutMs: 1_000,
    url: productLogIngestPathname,
  });
}

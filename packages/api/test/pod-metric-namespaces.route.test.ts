import {
  workerListPodMetricNamespacesPathname,
  workerListPodMetricNamespacesResponseSchema,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { readPodMetricNamespaceScope } from '../src/services/pod-metrics-namespace.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type ReadPodMetricNamespaceScope = typeof readPodMetricNamespaceScope;

const readPodMetricNamespaceScopeMock: Mock<ReadPodMetricNamespaceScope> = vi.hoisted(
  (): Mock<ReadPodMetricNamespaceScope> => vi.fn<ReadPodMetricNamespaceScope>(),
);

vi.mock(
  '../src/services/pod-metrics-namespace.service',
  (): { readPodMetricNamespaceScope: Mock<ReadPodMetricNamespaceScope> } => ({
    readPodMetricNamespaceScope: readPodMetricNamespaceScopeMock,
  }),
);

describe('Pod metric namespace route', (): void => {
  it('returns the provisioned project namespace scope to an authenticated worker', async (): Promise<void> => {
    applyApiRouteTestEnv();
    readPodMetricNamespaceScopeMock.mockResolvedValueOnce({ namespaceIds: ['prj_1', 'prj_2'] });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: { authorization: 'Bearer test-runtime-control-token' },
        method: 'GET',
        url: workerListPodMetricNamespacesPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(workerListPodMetricNamespacesResponseSchema.parse(response.json())).toEqual({
        namespaceIds: ['prj_1', 'prj_2'],
      });
    });
  });
});

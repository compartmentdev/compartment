import type { DomainHostPlan, SystemDomainMutationResponse, SystemDomainStatusResponse } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  activateKubernetesSystemDomain,
  resetManagedKubernetesSystemDomain,
  setKubernetesSystemDomain,
  verifyKubernetesSystemDomain,
} from '../src/services/kubernetes-system-domain.service';
import type { RetainedManagedDomainState } from '../src/services/kubernetes-install.service.types';
import type {
  KubernetesOperatorTarget,
  KubernetesSystemApiRequest,
} from '../src/services/kubernetes-operator.service.types';

type ApplyDomainRelease = (
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
) => Promise<void>;
type RequestSystemApi = <TResponse>(
  target: KubernetesOperatorTarget,
  request: KubernetesSystemApiRequest,
  parse: (value: JsonValue | null) => TResponse,
) => Promise<TResponse>;

interface DomainServiceMocks {
  applyRuntimeRelease: Mock<ApplyDomainRelease>;
  commitActiveRelease: Mock<ApplyDomainRelease>;
  requestSystemApi: Mock<RequestSystemApi>;
  readRetainedManagedState: Mock<() => Promise<RetainedManagedDomainState>>;
  waitForReadiness: Mock<ApplyDomainRelease>;
}

const mocks: DomainServiceMocks = vi.hoisted(
  (): DomainServiceMocks => ({
    applyRuntimeRelease: vi.fn<ApplyDomainRelease>(),
    commitActiveRelease: vi.fn<ApplyDomainRelease>(),
    requestSystemApi: vi.fn<RequestSystemApi>(),
    readRetainedManagedState: vi.fn<() => Promise<RetainedManagedDomainState>>(),
    waitForReadiness: vi.fn<ApplyDomainRelease>(),
  }),
);

vi.mock('../src/services/kubernetes-system-api.service', (): object => ({
  requestKubernetesSystemApi: mocks.requestSystemApi,
}));
vi.mock('../src/services/kubernetes-system-domain-release.service', (): object => ({
  applyRuntimeKubernetesDomainRelease: mocks.applyRuntimeRelease,
  commitActiveKubernetesDomainRelease: mocks.commitActiveRelease,
}));
vi.mock('../src/services/kubernetes-install-retained-state.service', (): object => ({
  readRetainedManagedKubernetesDomainState: mocks.readRetainedManagedState,
}));
vi.mock('../src/services/kubernetes-system-domain-readiness.service', (): object => ({
  waitForKubernetesSystemDomainReadiness: mocks.waitForReadiness,
}));

const target: KubernetesOperatorTarget = {
  chartPath: '/tmp/chart',
  namespace: 'compartment',
  releaseName: 'compartment',
  valuesPath: '/tmp/operator-values.yaml',
};
const customHostPlan: DomainHostPlan = {
  baseDomain: 'apps.example.com',
  domainKind: 'custom',
  issuerRef: { kind: 'Issuer', name: 'customer-issuer' },
  publicScheme: 'https',
  tlsMode: 'external',
};

describe('Kubernetes system-domain activation', (): void => {
  afterEach((): void => {
    mocks.applyRuntimeRelease.mockReset();
    mocks.commitActiveRelease.mockReset();
    mocks.requestSystemApi.mockReset();
    mocks.readRetainedManagedState.mockReset();
    mocks.waitForReadiness.mockReset();
  });

  it('rolls out the verified domain before finalizing activation in the database', async (): Promise<void> => {
    const events: string[] = [];
    mocks.requestSystemApi.mockImplementation(createSystemApiHandler(events));
    mocks.applyRuntimeRelease.mockImplementation(async (): Promise<void> => {
      events.push('helm:domain-rollout');
      await Promise.resolve();
    });
    mocks.commitActiveRelease.mockImplementation(async (): Promise<void> => {
      events.push('helm:domain-commit');
      await Promise.resolve();
    });

    const result: SystemDomainMutationResponse = await activateKubernetesSystemDomain(target);

    expect(result.setupVersion).toBe(4);
    expect(events).toEqual([
      'api:/internal/system/domain/status',
      'api:/internal/system/domain/verify',
      'helm:domain-rollout',
      'api:/internal/system/domain/activate',
      'helm:domain-commit',
    ]);
    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, customHostPlan, 3);
    expect(mocks.commitActiveRelease).toHaveBeenCalledWith(target, customHostPlan, 4);
  });

  it('does not finalize activation when the runtime rollout fails', async (): Promise<void> => {
    const events: string[] = [];
    mocks.requestSystemApi.mockImplementation(createSystemApiHandler(events));
    mocks.applyRuntimeRelease.mockRejectedValue(new Error('rollout failed'));

    await expect(activateKubernetesSystemDomain(target)).rejects.toThrow('rollout failed');

    expect(events).toEqual(['api:/internal/system/domain/status', 'api:/internal/system/domain/verify']);
    expect(mocks.commitActiveRelease).not.toHaveBeenCalled();
  });

  it('waits for the active runtime before committing an activation retry with no pending operation', async (): Promise<void> => {
    const status: SystemDomainStatusResponse = activeStatus();
    mocks.requestSystemApi.mockImplementation(
      async <TResponse>(
        _requestTarget: KubernetesOperatorTarget,
        _request: KubernetesSystemApiRequest,
        parse: (value: JsonValue | null) => TResponse,
      ): Promise<TResponse> => await Promise.resolve(parse(toJsonValue(status))),
    );

    await activateKubernetesSystemDomain(target);

    expect(mocks.waitForReadiness).toHaveBeenCalledWith(target, status.active);
    expect(mocks.waitForReadiness.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.commitActiveRelease.mock.invocationCallOrder[0]!,
    );
  });

  it('leaves the pending release mounted when the private activation request fails', async (): Promise<void> => {
    const events: string[] = [];
    mocks.requestSystemApi.mockImplementation(
      async <TResponse>(
        requestTarget: KubernetesOperatorTarget,
        request: KubernetesSystemApiRequest,
        parse: (value: JsonValue | null) => TResponse,
      ): Promise<TResponse> => {
        if (request.path.endsWith('/activate')) {
          events.push(`api:${request.path}`);
          throw new Error('activation failed');
        }
        return await createSystemApiHandler(events)(requestTarget, request, parse);
      },
    );

    await expect(activateKubernetesSystemDomain(target)).rejects.toThrow('activation failed');

    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, customHostPlan, 3);
    expect(mocks.commitActiveRelease).not.toHaveBeenCalled();
  });

  it('maps set and verify to versioned private mutations', async (): Promise<void> => {
    mocks.requestSystemApi.mockImplementation(createSystemApiHandler([]));

    await setKubernetesSystemDomain({
      ...target,
      baseDomain: 'apps.example.com',
      issuerRef: { kind: 'Issuer', name: 'customer-issuer' },
    });
    await verifyKubernetesSystemDomain({ ...target, expectedSetupVersion: 2 });

    expect(mocks.requestSystemApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining(target),
      expect.objectContaining({
        body: { expectedSetupVersion: 2, hostPlan: customHostPlan },
        method: 'POST',
        path: '/internal/system/domain/set',
      }),
      expect.any(Function),
    );
    expect(mocks.requestSystemApi).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining(target),
      expect.objectContaining({
        body: { expectedSetupVersion: 2 },
        method: 'POST',
        path: '/internal/system/domain/verify',
      }),
      expect.any(Function),
    );
  });

  it('fails verify while DNS ownership or routing is pending', async (): Promise<void> => {
    const handler: RequestSystemApi = async <TResponse>(
      _target: KubernetesOperatorTarget,
      request: KubernetesSystemApiRequest,
      parse: (value: JsonValue | null) => TResponse,
    ): Promise<TResponse> => {
      if (request.method === 'GET') {
        return await Promise.resolve(parse(toJsonValue(pendingStatus())));
      }
      return await Promise.resolve(parse(toJsonValue(mutationResponse(2, pendingStatus()))));
    };
    mocks.requestSystemApi.mockImplementation(handler);

    await expect(verifyKubernetesSystemDomain({ ...target, expectedSetupVersion: 2 })).rejects.toThrow(
      'System-domain verification did not converge',
    );
  });

  it('rolls back to retained managed state before committing the API reset', async (): Promise<void> => {
    const events: string[] = [];
    const managedHostPlan: DomainHostPlan = {
      baseDomain: 'managed.compartment.run',
      domainKind: 'managed',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      publicScheme: 'https',
      tlsMode: 'broker-dns01',
    };
    mocks.readRetainedManagedState.mockResolvedValue({
      acmeEmail: 'admin@example.com',
      allocationId: 'allocation-1',
      baseDomain: managedHostPlan.baseDomain,
      brokerToken: 'token',
      brokerUrl: 'https://broker.compartment.run',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      publicProtocol: 'https',
      tlsMode: 'broker-dns01',
    });
    mocks.requestSystemApi.mockImplementation(
      async <TResponse>(
        _requestTarget: KubernetesOperatorTarget,
        request: KubernetesSystemApiRequest,
        parse: (value: JsonValue | null) => TResponse,
      ): Promise<TResponse> => {
        events.push(`api:${request.path}`);
        if (request.path.endsWith('/status')) {
          return await Promise.resolve(parse(toJsonValue(pendingStatus())));
        }
        return await Promise.resolve(
          parse(toJsonValue(mutationResponse(3, { ...activeStatus(), active: managedHostPlan, pending: null }))),
        );
      },
    );
    mocks.applyRuntimeRelease.mockImplementation(async (): Promise<void> => {
      events.push('helm:domain-rollout');
      await Promise.resolve();
    });
    mocks.commitActiveRelease.mockImplementation(async (): Promise<void> => {
      events.push('helm:domain-commit');
      await Promise.resolve();
    });
    mocks.waitForReadiness.mockImplementation(async (): Promise<void> => {
      events.push('kubernetes:domain-ready');
      await Promise.resolve();
    });

    await resetManagedKubernetesSystemDomain(target);

    expect(events).toEqual([
      'api:/internal/system/domain/status',
      'helm:domain-rollout',
      'kubernetes:domain-ready',
      'api:/internal/system/domain/reset-managed',
      'helm:domain-commit',
    ]);
    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, managedHostPlan, 3);
    expect(mocks.waitForReadiness).toHaveBeenCalledWith(target, managedHostPlan);
    expect(mocks.commitActiveRelease).toHaveBeenCalledWith(target, managedHostPlan, 3);
  });
});

function createSystemApiHandler(events: string[]): RequestSystemApi {
  return async <TResponse>(
    _target: KubernetesOperatorTarget,
    request: KubernetesSystemApiRequest,
    parse: (value: JsonValue | null) => TResponse,
  ): Promise<TResponse> => {
    events.push(`api:${request.path}`);
    if (request.path.endsWith('/status')) {
      return await Promise.resolve(parse(toJsonValue(pendingStatus())));
    }
    if (request.path.endsWith('/verify')) {
      return await Promise.resolve(parse(toJsonValue(mutationResponse(3, verifiedStatus()))));
    }
    return await Promise.resolve(parse(toJsonValue(mutationResponse(4, activeStatus()))));
  };
}

function pendingStatus(): SystemDomainStatusResponse {
  return buildStatus(2, 'pending_dns');
}

function verifiedStatus(): SystemDomainStatusResponse {
  return buildStatus(3, 'verified');
}

function activeStatus(): SystemDomainStatusResponse {
  return { ...buildStatus(4, 'verified'), active: customHostPlan, pending: null };
}

function buildStatus(setupVersion: number, operationStatus: 'pending_dns' | 'verified'): SystemDomainStatusResponse {
  return {
    active: {
      baseDomain: 'managed.compartment.run',
      domainKind: 'managed',
      publicScheme: 'https',
      tlsMode: 'broker-dns01',
    },
    activeDomainHealth: {
      checkedAt: null,
      failureCode: null,
      failureMessage: null,
      status: 'unknown',
    },
    pending: {
      failureCode: null,
      failureMessage: null,
      hostPlan: customHostPlan,
      operationId: 'domop_123',
      requiredDnsRecords: [],
      status: operationStatus,
    },
    setupVersion,
  };
}

function toJsonValue(value: object): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function mutationResponse(setupVersion: number, status: SystemDomainStatusResponse): SystemDomainMutationResponse {
  return { operationId: `domop_${setupVersion.toString()}`, setupVersion, status };
}

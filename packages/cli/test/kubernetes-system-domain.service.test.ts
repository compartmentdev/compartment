import type { DomainHostPlan, SystemDomainMutationResponse, SystemDomainStatusResponse } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  activateKubernetesSystemDomain,
  attachKubernetesSystemDomainCertificate,
  resetManagedKubernetesSystemDomain,
  setKubernetesSystemDomain,
  verifyKubernetesSystemDomain,
} from '../src/services/kubernetes-system-domain.service';
import type { RetainedManagedDomainState } from '../src/services/kubernetes-install.service.types';
import type {
  KubernetesOperatorTarget,
  KubernetesDomainReleaseUpdate,
  KubernetesSystemApiRequest,
  StagedKubernetesDomainCertificate,
} from '../src/services/kubernetes-operator.service.types';

type ApplyDomainRelease = (
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
  operationId?: string,
) => Promise<void>;
type ApplyDomainReleaseUpdate = (
  target: KubernetesOperatorTarget,
  update: KubernetesDomainReleaseUpdate,
) => Promise<void>;
type StageDomainCertificate = (
  target: KubernetesOperatorTarget,
  operationId: string,
) => Promise<StagedKubernetesDomainCertificate>;
type RequestSystemApi = <TResponse>(
  target: KubernetesOperatorTarget,
  request: KubernetesSystemApiRequest,
  parse: (value: JsonValue | null) => TResponse,
) => Promise<TResponse>;

interface DomainServiceMocks {
  applyRuntimeRelease: Mock<ApplyDomainRelease>;
  applyRelease: Mock<ApplyDomainReleaseUpdate>;
  commitActiveRelease: Mock<ApplyDomainRelease>;
  requestSystemApi: Mock<RequestSystemApi>;
  readRetainedManagedState: Mock<() => Promise<RetainedManagedDomainState>>;
  stageCertificate: Mock<StageDomainCertificate>;
}

const mocks: DomainServiceMocks = vi.hoisted(
  (): DomainServiceMocks => ({
    applyRuntimeRelease: vi.fn<ApplyDomainRelease>(),
    applyRelease: vi.fn<ApplyDomainReleaseUpdate>(),
    commitActiveRelease: vi.fn<ApplyDomainRelease>(),
    requestSystemApi: vi.fn<RequestSystemApi>(),
    readRetainedManagedState: vi.fn<() => Promise<RetainedManagedDomainState>>(),
    stageCertificate: vi.fn<StageDomainCertificate>(),
  }),
);

vi.mock('../src/services/kubernetes-system-api.service', (): object => ({
  requestKubernetesSystemApi: mocks.requestSystemApi,
}));
vi.mock('../src/services/kubernetes-system-domain-release.service', (): object => ({
  applyRuntimeKubernetesDomainRelease: mocks.applyRuntimeRelease,
  commitActiveKubernetesDomainRelease: mocks.commitActiveRelease,
  applyKubernetesDomainRelease: mocks.applyRelease,
  readRetainedManagedDomainState: vi.fn(),
  stageKubernetesDomainCertificate: mocks.stageCertificate,
}));
vi.mock('../src/services/kubernetes-install-retained-state.service', (): object => ({
  readRetainedManagedKubernetesDomainState: mocks.readRetainedManagedState,
}));

const target: KubernetesOperatorTarget = {
  chartPath: '/tmp/chart',
  namespace: 'compartment',
  releaseName: 'compartment',
  valuesPath: '/tmp/operator-values.yaml',
};
const customHostPlan: DomainHostPlan = {
  baseDomain: 'apps.example.com',
  caddyMode: 'custom-http',
  domainKind: 'custom',
  publicScheme: 'https',
  tlsMode: 'external',
};

describe('Kubernetes system-domain activation', (): void => {
  afterEach((): void => {
    mocks.applyRuntimeRelease.mockReset();
    mocks.applyRelease.mockReset();
    mocks.commitActiveRelease.mockReset();
    mocks.requestSystemApi.mockReset();
    mocks.readRetainedManagedState.mockReset();
    mocks.stageCertificate.mockReset();
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
    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, customHostPlan, 3, 'domop_123');
    expect(mocks.commitActiveRelease).toHaveBeenCalledWith(target, customHostPlan, 4, 'domop_123');
  });

  it('does not finalize activation when the runtime rollout fails', async (): Promise<void> => {
    const events: string[] = [];
    mocks.requestSystemApi.mockImplementation(createSystemApiHandler(events));
    mocks.applyRuntimeRelease.mockRejectedValue(new Error('rollout failed'));

    await expect(activateKubernetesSystemDomain(target)).rejects.toThrow('rollout failed');

    expect(events).toEqual(['api:/internal/system/domain/status', 'api:/internal/system/domain/verify']);
    expect(mocks.commitActiveRelease).not.toHaveBeenCalled();
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

    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, customHostPlan, 3, 'domop_123');
    expect(mocks.commitActiveRelease).not.toHaveBeenCalled();
  });

  it('maps set and verify to versioned private mutations', async (): Promise<void> => {
    mocks.requestSystemApi.mockImplementation(createSystemApiHandler([]));

    await setKubernetesSystemDomain({ ...target, baseDomain: 'apps.example.com', tlsMode: 'external' });
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

  it('stages and mounts certificate material before attaching it through the private API', async (): Promise<void> => {
    const certificateHostPlan: DomainHostPlan = { ...customHostPlan, caddyMode: 'custom-cert', tlsMode: 'custom-cert' };
    const status: SystemDomainStatusResponse = {
      ...pendingStatus(),
      pending: { ...pendingStatus().pending!, hostPlan: certificateHostPlan },
    };
    mocks.stageCertificate.mockResolvedValue({
      certificate: 'certificate',
      fingerprint: 'fingerprint',
      privateKey: 'private-key',
      secretName: 'domain-tls-domop-123',
    });
    mocks.requestSystemApi.mockImplementation(
      async <TResponse>(
        _requestTarget: KubernetesOperatorTarget,
        request: KubernetesSystemApiRequest,
        parse: (value: JsonValue | null) => TResponse,
      ): Promise<TResponse> =>
        await Promise.resolve(
          request.path.endsWith('/status')
            ? parse(toJsonValue(status))
            : parse(toJsonValue(mutationResponse(3, status))),
        ),
    );

    await attachKubernetesSystemDomainCertificate({
      ...target,
      certificateFile: '/tmp/fullchain.pem',
      privateKeyFile: '/tmp/privkey.pem',
    });

    expect(mocks.applyRelease).toHaveBeenCalledWith(
      expect.objectContaining(target),
      expect.objectContaining({
        pendingOperationId: 'domop_123',
        pendingTlsSecretName: 'domain-tls-domop-123',
      }),
    );
    expect(mocks.requestSystemApi).toHaveBeenLastCalledWith(
      expect.objectContaining(target),
      expect.objectContaining({
        body: { expectedSetupVersion: 2 },
        method: 'POST',
        path: '/internal/system/domain/attach-cert',
      }),
      expect.any(Function),
    );
  });

  it('rolls back to retained managed state before committing the API reset', async (): Promise<void> => {
    const events: string[] = [];
    const managedHostPlan: DomainHostPlan = {
      baseDomain: 'managed.compartment.run',
      caddyMode: 'managed',
      domainKind: 'managed',
      publicScheme: 'https',
      tlsMode: 'broker-dns01',
    };
    mocks.readRetainedManagedState.mockResolvedValue({
      acmeEmail: 'admin@example.com',
      baseDomain: managedHostPlan.baseDomain,
      brokerToken: 'token',
      brokerUrl: 'https://broker.compartment.run',
      publicProtocol: 'https',
      tlsMode: 'managed',
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

    await resetManagedKubernetesSystemDomain(target);

    expect(events).toEqual([
      'api:/internal/system/domain/status',
      'helm:domain-rollout',
      'api:/internal/system/domain/reset-managed',
      'helm:domain-commit',
    ]);
    expect(mocks.applyRuntimeRelease).toHaveBeenCalledWith(target, managedHostPlan, 3);
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
      caddyMode: 'managed',
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
      certificate: null,
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

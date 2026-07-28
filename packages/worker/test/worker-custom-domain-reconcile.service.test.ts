import type { WorkerClaimCustomDomainReconcileResponse } from '@compartment/contracts';
import type { ApplyBundle, KubeManifest, KubeObservedManifest, KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { executeCustomDomainReconcile } from '../src/services/worker-custom-domain-reconcile.service';
import type { WorkerCustomDomainConfig } from '../src/config';

type ImportOriginal = <Module>() => Promise<Module>;

const complete: Mock = vi.hoisted((): Mock => vi.fn());
const fail: Mock = vi.hoisted((): Mock => vi.fn());
const observe: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/sdk', async (importOriginal: ImportOriginal): Promise<object> => {
  const original: object = await importOriginal<object>();
  return {
    ...original,
    completeCustomDomainReconcile: complete,
    failCustomDomainReconcile: fail,
    observeCustomDomainReconcile: observe,
  };
});

const request: CompartmentRequester = vi.fn() as CompartmentRequester;
const config: WorkerCustomDomainConfig = {
  caddyServiceName: 'compartment-caddy',
  ingressClassName: 'traefik',
  issuerRef: { kind: 'Issuer' as const, name: 'compartment-platform' },
  namespace: 'compartment',
};

describe('worker custom domain reconcile', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    observe.mockResolvedValue({ applied: true });
  });

  it('does not activate Edge completion before Certificate Ready=True', async (): Promise<void> => {
    const runtime: KubeRuntime = createRuntime(
      (manifest: KubeManifest): KubeObservedManifest => ({
        ...manifest,
        ...(manifest.kind === 'Certificate'
          ? {
              metadata: { ...manifest.metadata, generation: 1 },
              status: { conditions: [{ status: 'False', type: 'Ready' }], observedGeneration: 1 },
            }
          : {}),
      }),
    );

    await executeCustomDomainReconcile(request, runtime, reconcileClaim(), config);

    expect(observe).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ certificatePresent: true, certificateReady: false, ingressPresent: true }),
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes only after both exact objects exist and Certificate is ready', async (): Promise<void> => {
    const runtime: KubeRuntime = createRuntime(
      (manifest: KubeManifest): KubeObservedManifest => ({
        ...manifest,
        ...(manifest.kind === 'Certificate'
          ? {
              metadata: { ...manifest.metadata, generation: 1 },
              status: { conditions: [{ status: 'True', type: 'Ready' }], observedGeneration: 1 },
            }
          : {}),
      }),
    );

    await executeCustomDomainReconcile(request, runtime, reconcileClaim(), config);

    expect(complete).toHaveBeenCalledWith(request, { leaseId: 'lease_1', observedGeneration: 2 });
  });

  it('does not settle deletion while either exact Kubernetes object remains', async (): Promise<void> => {
    const runtime: KubeRuntime = createRuntime((manifest: KubeManifest): KubeObservedManifest | null =>
      manifest.kind === 'Ingress' ? manifest : null,
    );

    await executeCustomDomainReconcile(request, runtime, deleteClaim(), config);

    expect(complete).not.toHaveBeenCalled();
  });

  it('does not mutate Kubernetes after the API rejects a stale lease preflight', async (): Promise<void> => {
    observe.mockResolvedValueOnce({ applied: false });
    const runtime: KubeRuntime = createRuntime((manifest: KubeManifest): KubeObservedManifest => manifest);

    await executeCustomDomainReconcile(request, runtime, reconcileClaim(), config);

    expect(Reflect.get(runtime, 'apply')).not.toHaveBeenCalled();
    expect(Reflect.get(runtime, 'delete')).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

function reconcileClaim(): WorkerClaimCustomDomainReconcileResponse {
  return {
    leaseId: 'lease_1',
    target: {
      desiredGeneration: 2,
      domainId: 'cdom_1',
      host: 'app.customer.example.com',
      operation: 'reconcile',
    },
  };
}

function deleteClaim(): WorkerClaimCustomDomainReconcileResponse {
  return { ...reconcileClaim(), target: { ...reconcileClaim().target!, operation: 'delete' } };
}

function createRuntime(read: (manifest: KubeManifest) => KubeObservedManifest | null): KubeRuntime {
  async function apply(bundle: ApplyBundle): Promise<KubeManifest[]> {
    return await Promise.resolve(bundle.objects);
  }
  async function deleteObjects(manifests: KubeManifest[]): Promise<void> {
    await Promise.resolve(manifests);
  }
  async function readObject(manifest: KubeManifest): Promise<KubeObservedManifest | null> {
    return await Promise.resolve(read(manifest));
  }
  const runtime: Partial<KubeRuntime> = {
    apply: vi.fn(apply),
    delete: vi.fn(deleteObjects),
    read: vi.fn(readObject),
  };
  return runtime as KubeRuntime;
}

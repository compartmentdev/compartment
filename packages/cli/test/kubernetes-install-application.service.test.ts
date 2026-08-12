import { describe, expect, it, vi, type Mock } from 'vitest';
import { installIntoKubernetes } from '../src/services/kubernetes-install-application.service';
import type { KubernetesInstallApplicationInput } from '../src/services/kubernetes-install-input.service.types';
import type { KubernetesInstallDeploymentResult } from '../src/services/kubernetes-install.service.types';
import { KubernetesExistingClusterPreflightError } from '../src/services/kubernetes-existing-cluster-preflight.support';
import type { KubernetesOperatorIssuerAssessment } from '../src/services/kubernetes-operator-issuer-trust.service.types';

interface ApplicationMocks {
  deploy: Mock<() => Promise<KubernetesInstallDeploymentResult>>;
  inspectIssuer: Mock<() => Promise<KubernetesOperatorIssuerAssessment>>;
}

const mocks: ApplicationMocks = vi.hoisted(
  (): ApplicationMocks => ({
    deploy: vi.fn<() => Promise<KubernetesInstallDeploymentResult>>(),
    inspectIssuer: vi.fn<() => Promise<KubernetesOperatorIssuerAssessment>>(),
  }),
);

vi.mock('../src/services/kubernetes-chart-name', (): object => ({
  readCompartmentChartFullname: async (): Promise<string> => await Promise.resolve('compartment'),
}));
vi.mock('../src/services/kubernetes-install-registry.service', (): object => ({
  resolveKubernetesInstallRegistryConfiguration: async (): Promise<object> =>
    await Promise.resolve({
      registryHostname: '',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'registry-ca' },
    }),
}));
vi.mock('../src/services/kubernetes-existing-cluster-preflight.cert-manager', (): object => ({
  assertOperatorRegistryIssuer: async (): Promise<object> => await Promise.resolve({ detail: 'CA', trust: 'ca' }),
  assertOperatorTlsSecret: vi.fn(),
}));
vi.mock('../src/services/kubernetes-install-tls.service', (): object => ({
  readKubernetesTlsIssuerReference: async (): Promise<object> =>
    await Promise.resolve({ kind: 'ClusterIssuer', name: 'public-http01' }),
  readOperatorOwnedKubernetesTlsSecretName: vi.fn(),
  usesOperatorOwnedKubernetesTlsSecret: async (): Promise<boolean> => await Promise.resolve(false),
}));
vi.mock('../src/services/kubernetes-operator-issuer-trust.service', async (importOriginal): Promise<object> => {
  const original: object = await importOriginal();
  return { ...original, inspectOperatorIssuer: mocks.inspectIssuer };
});
vi.mock('../src/services/kubernetes-install.service', (): object => ({
  deployAndWaitForKubernetesInstall: mocks.deploy,
}));

describe('Kubernetes install application certificate preflight', (): void => {
  it('rejects an HTTP-01-only public issuer before deployment mutation', async (): Promise<void> => {
    mocks.inspectIssuer.mockResolvedValue({ detail: 'HTTP-01 only', dns01: false, ready: true, trust: 'acme' });

    await expect(installIntoKubernetes(operatorInstallInput())).rejects.toBeInstanceOf(
      KubernetesExistingClusterPreflightError,
    );
    expect(mocks.deploy).not.toHaveBeenCalled();
  });
});

function operatorInstallInput(): KubernetesInstallApplicationInput {
  return {
    clearIngressEndpoint: false,
    domain: { baseDomain: 'apps.example.com', mode: 'operator', publicProtocol: 'https' },
    ingressClass: 'traefik',
    kubeContext: 'production',
    kubeconfigPath: '/tmp/kubeconfig',
    namespace: 'compartment',
    owner: { email: 'owner@example.com', organizationName: 'Acme', password: 'strong-password' },
    progress: { report: vi.fn() },
    releaseName: 'compartment',
    storageClass: 'local-path',
    valuesPath: '/tmp/values.yaml',
  };
}

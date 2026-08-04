import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandProgress, CommandProgressReportOptions } from '../src/commands/command.progress.types';
import {
  reportKubernetesInstallWarning,
  verifyKubernetesInstallRegistryNodePullForInstall,
} from '../src/services/kubernetes-install-registry-warning.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallState,
} from '../src/services/kubernetes-install.service.types';

interface RegistryWarningMocks {
  verifyRegistryNodePull: Mock<() => Promise<void>>;
}

const mocks: RegistryWarningMocks = vi.hoisted(
  (): RegistryWarningMocks => ({
    verifyRegistryNodePull: vi.fn(),
  }),
);

vi.mock('../src/services/kubernetes-install-registry-verification.service', (): object => ({
  verifyKubernetesInstallRegistryNodePull: mocks.verifyRegistryNodePull,
}));

describe('registry node-pull policy', (): void => {
  beforeEach((): void => {
    mocks.verifyRegistryNodePull.mockReset();
  });

  it('keeps node-pull failures blocking in both domain modes', async (): Promise<void> => {
    const reachabilityFailure: Error = new Error('connection refused');
    const tlsFailure: Error = new Error('certificate signed by unknown authority');

    mocks.verifyRegistryNodePull.mockRejectedValueOnce(reachabilityFailure).mockRejectedValueOnce(tlsFailure);
    await expect(verifyKubernetesInstallRegistryNodePullForInstall(input(), state('custom'))).rejects.toBe(
      reachabilityFailure,
    );
    await expect(verifyKubernetesInstallRegistryNodePullForInstall(input(), state('managed'))).rejects.toBe(tlsFailure);
  });

  it('renders warnings as explicit lines even when normal progress is hidden', (): void => {
    const report: Mock<(message: string, options?: CommandProgressReportOptions) => void> = vi.fn();
    const progress: CommandProgress = { mode: 'hidden', report, stop: vi.fn() };

    reportKubernetesInstallWarning({ ...input(), progress }, 'WARNING: unresolved registry hostname');

    expect(report).toHaveBeenCalledWith('WARNING: unresolved registry hostname', { renderMode: 'line' });
  });
});

function state(domainMode: 'custom' | 'managed'): KubernetesInstallState {
  return {
    acmeEmail: 'admin@example.com',
    baseDomain: 'acme.compartment.run',
    brokerUrl: 'https://broker.compartment.run',
    domainMode,
    ingressClassName: 'traefik',
    ingressEndpoint: { type: 'A', value: '203.0.113.10' },
    ingressTargets: [{ type: 'A', value: '203.0.113.10' }],
    installationId: 'installation-123',
    managedDomainAcmeDnsToken: 'token',
    publicProtocol: 'https',
    registryHostname: 'registry.acme.compartment.run',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    tlsMode: 'broker-dns01',
  };
}

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    chartFullname: 'compartment',
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'managed',
    ingressClassName: 'traefik',
    namespace: 'compartment',
    registryHostname: 'registry.acme.compartment.run',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    releaseName: 'compartment',
    valuesPath: 'values.yaml',
  };
}

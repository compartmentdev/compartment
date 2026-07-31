import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandProgress, CommandProgressReportOptions } from '../src/commands/command.progress.types';
import { RegistryNodePullDnsError } from '../src/services/kubernetes-install-registry-verification-error';
import {
  reportKubernetesInstallWarning,
  verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace,
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

describe('managed registry node-pull warning policy', (): void => {
  beforeEach((): void => {
    mocks.verifyRegistryNodePull.mockReset();
  });

  it('continues only managed installs after a DNS-specific pull failure', async (): Promise<void> => {
    mocks.verifyRegistryNodePull.mockRejectedValue(
      new RegistryNodePullDnsError('Registry node pull failed: lookup registry.acme.compartment.run: no such host'),
    );
    const warning: string | null = await verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace(
      input(),
      state('managed'),
    );

    expect(warning).toContain('WARNING: Registry node pull failed');
    expect(warning).toContain('registry.acme.compartment.run');
    expect(warning).toContain('Re-run compartment install after DNS resolves');
  });

  it('keeps custom-domain and non-DNS pull failures blocking', async (): Promise<void> => {
    const dnsFailure: RegistryNodePullDnsError = new RegistryNodePullDnsError('no such host');
    const tlsFailure: Error = new Error('certificate signed by unknown authority');

    mocks.verifyRegistryNodePull.mockRejectedValueOnce(dnsFailure).mockRejectedValueOnce(tlsFailure);
    await expect(verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace(input(), state('custom'))).rejects.toBe(
      dnsFailure,
    );
    await expect(verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace(input(), state('managed'))).rejects.toBe(
      tlsFailure,
    );
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

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { readRegistryServiceAddresses } from '../src/services/kubernetes-install-registry-service.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

const runCommand: Mock<() => Promise<CommandResult>> = vi.hoisted((): Mock<() => Promise<CommandResult>> => vi.fn());

vi.mock('../src/command-runner', (): object => ({ runCommand }));

describe('registry Service address discovery', (): void => {
  beforeEach((): void => {
    runCommand.mockReset();
  });

  it('returns only usable IPv4 ClusterIP addresses', async (): Promise<void> => {
    const ipv4Address: string = [10, 43, 162, 108].join('.');
    const ipv6Address: string = ['fd00', '', '10'].join(':');
    runCommand.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ spec: { clusterIP: ipv4Address, clusterIPs: [ipv4Address, ipv6Address] } }),
    });

    await expect(readRegistryServiceAddresses(input())).resolves.toEqual([ipv4Address]);
  });

  it('rejects a Service without an IPv4 ClusterIP', async (): Promise<void> => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ spec: { clusterIP: ['fd00', '', '10'].join(':') } }),
    });

    await expect(readRegistryServiceAddresses(input())).rejects.toThrow('has no usable ClusterIP');
  });
});

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'managed',
    ingressClassName: 'traefik',
    namespace: 'compartment',
    registryHostname: '',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'registry-ca' },
    releaseName: 'compartment',
    valuesPath: 'values.yaml',
  };
}

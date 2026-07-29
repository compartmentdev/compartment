import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import {
  assertOperatorRegistryIssuer,
  assertOperatorTlsSecret,
} from '../src/services/kubernetes-existing-cluster-preflight.cert-manager';

vi.mock('../src/command-runner', (): object => ({
  runCommand: vi.fn(),
  runCommandWithInput: vi.fn(),
}));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('operator registry issuer preflight', (): void => {
  it('accepts an existing namespaced Issuer', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(success('issuer.cert-manager.io/customer-registry\n'));

    await expect(
      assertOperatorRegistryIssuer({
        kubeContext: 'production',
        kubeconfigPath: '/tmp/kubeconfig',
        namespace: 'compartment',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-registry' },
      }),
    ).resolves.toBeUndefined();
    expect(mockedRunCommand.mock.calls[0]?.[0]).toContain('issuers.cert-manager.io');
    expect(mockedRunCommand.mock.calls[0]?.[0]).toContain('compartment');
  });

  it('rejects a missing ClusterIssuer before Helm mutation', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'clusterissuer.cert-manager.io "customer-registry" not found',
      stdout: '',
    });

    await expect(
      assertOperatorRegistryIssuer({
        kubeContext: 'production',
        kubeconfigPath: '/tmp/kubeconfig',
        namespace: 'compartment',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'customer-registry' },
      }),
    ).rejects.toThrow(
      'Private registry ClusterIssuer customer-registry is not available: clusterissuer.cert-manager.io "customer-registry" not found',
    );
  });

  it('accepts an existing operator TLS Secret', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(success('kubernetes.io/tls'));

    await expect(
      assertOperatorTlsSecret(
        {
          kubeContext: 'production',
          kubeconfigPath: '/tmp/kubeconfig',
          namespace: 'compartment',
        },
        'operator-platform-tls',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects an operator Secret that is not TLS material', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(success('Opaque'));

    await expect(
      assertOperatorTlsSecret(
        {
          kubeContext: 'production',
          kubeconfigPath: '/tmp/kubeconfig',
          namespace: 'compartment',
        },
        'operator-platform-tls',
      ),
    ).rejects.toThrow('is not an available kubernetes.io/tls Secret: Secret type is Opaque');
  });
});

function success(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

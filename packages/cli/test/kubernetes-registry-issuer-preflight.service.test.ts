import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import {
  assertOperatorRegistryIssuer,
  assertOperatorTlsSecret,
} from '../src/services/kubernetes-existing-cluster-preflight.cert-manager';
import { assertRegistryIpIssuerAssessment } from '../src/services/kubernetes-operator-issuer-trust.service';
import type { KubernetesOperatorIssuerAssessment } from '../src/services/kubernetes-operator-issuer-trust.service.types';

vi.mock('../src/command-runner', (): object => ({
  runCommand: vi.fn(),
  runCommandWithInput: vi.fn(),
}));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('operator registry issuer preflight', (): void => {
  it('accepts only a CA issuer assessment for registry IP certificates', (): void => {
    expect((): void => assertRegistryIpIssuerAssessment({ detail: 'Private CA.', trust: 'ca' })).not.toThrow();
    expect((): void => assertRegistryIpIssuerAssessment({ detail: 'Public ACME.', trust: 'acme' })).toThrow(
      'Private registry IP certificates require a cert-manager CA issuer',
    );
  });
  it('accepts an existing namespaced Issuer', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(
      success('{"spec":{"acme":{"server":"https://acme-v02.api.letsencrypt.org/directory"}}}'),
    );

    await expect(
      assertOperatorRegistryIssuer({
        kubeContext: 'production',
        kubeconfigPath: '/tmp/kubeconfig',
        namespace: 'compartment',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-registry' },
      }),
    ).resolves.toMatchObject({ trust: 'acme' });
    expect(mockedRunCommand.mock.calls[0]?.[0]).toContain('issuers.cert-manager.io');
    expect(mockedRunCommand.mock.calls[0]?.[0]).toContain('compartment');
  });

  it('warns for a private ACME server instead of assuming public trust', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(
      success('{"spec":{"acme":{"server":"https://acme.internal.example/directory"}}}'),
    );

    const assessment: KubernetesOperatorIssuerAssessment = await assertOperatorRegistryIssuer({
      kubeContext: 'production',
      kubeconfigPath: '/tmp/kubeconfig',
      namespace: 'compartment',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'private-acme' },
    });

    expect(assessment.trust).toBe('unknown');
    expect(assessment.detail).toContain('ACME does not guarantee public trust');
  });

  it('rejects a self-signed issuer with the required registry CA trust explained', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(success('{"spec":{"selfSigned":{}}}'));

    await expect(
      assertOperatorRegistryIssuer({
        kubeContext: 'production',
        kubeconfigPath: '/tmp/kubeconfig',
        namespace: 'compartment',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'self-signed' },
      }),
    ).rejects.toThrow(
      'uses spec.selfSigned and cannot satisfy an operator-owned installation. Use a CA issuer whose CA is distributed to every node and the operator machine for the private registry.',
    );
  });

  it('classifies a private CA issuer as a trust-distribution warning', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue(success('{"spec":{"ca":{"secretName":"private-ca"}}}'));

    const assessment: KubernetesOperatorIssuerAssessment = await assertOperatorRegistryIssuer({
      kubeContext: 'production',
      kubeconfigPath: '/tmp/kubeconfig',
      namespace: 'compartment',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'private-ca' },
    });
    expect(assessment.trust).toBe('ca');
    expect(assessment.detail).toContain('trust stores of every Kubernetes node and the operator machine');
  });

  it('warns instead of failing when RBAC prevents issuer inspection', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (Forbidden): clusterissuers.cert-manager.io is forbidden',
      stdout: '',
    });

    await expect(
      assertOperatorRegistryIssuer({
        kubeContext: 'production',
        kubeconfigPath: '/tmp/kubeconfig',
        namespace: 'compartment',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'restricted' },
      }),
    ).resolves.toMatchObject({ trust: 'unreadable' });
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
      'Selected ClusterIssuer customer-registry is not available: clusterissuer.cert-manager.io "customer-registry" not found',
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

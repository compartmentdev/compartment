import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { readKubernetesInstallResourceInventory } from '../src/services/kubernetes-install-inventory.service';
import type { KubernetesInstallInventoryInput } from '../src/services/kubernetes-install-inventory.service.types';

interface InventoryMocks {
  runCommand: Mock<(command: readonly string[]) => Promise<CommandResult>>;
}

const mocks: InventoryMocks = vi.hoisted(
  (): InventoryMocks => ({ runCommand: vi.fn<(command: readonly string[]) => Promise<CommandResult>>() }),
);

vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));

const input: KubernetesInstallInventoryInput = {
  resolvedKubeconfig: {
    clusterServer: 'https://cluster.example.test',
    contextName: 'production',
    path: '/tmp/kubeconfig',
  },
};

describe('Kubernetes install inventory', (): void => {
  beforeEach((): void => {
    mocks.runCommand.mockReset();
  });

  it('discovers exact namespaced and cluster issuer choices', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      const resource: string = command.join(' ');
      if (resource.includes('ingressclasses')) {
        return await Promise.resolve(result({ items: [{ metadata: { name: 'nginx' } }] }));
      }
      if (resource.includes('storageclasses')) {
        return await Promise.resolve(result({ items: [{ metadata: { name: 'fast' } }] }));
      }
      if (resource.includes('clusterissuers')) {
        return await Promise.resolve(result({ items: [{ metadata: { name: 'cluster-registry-ca' } }] }));
      }
      return await Promise.resolve(result({ items: [{ metadata: { name: 'namespace-registry-ca' } }] }));
    });

    await expect(readKubernetesInstallResourceInventory(input, 'production', 'compartment')).resolves.toMatchObject({
      issuers: [
        { kind: 'Issuer', name: 'namespace-registry-ca' },
        { kind: 'ClusterIssuer', name: 'cluster-registry-ca' },
      ],
    });
  });

  it('turns an absent ClusterIssuer resource type into guided prerequisite failure', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(
      async (command: readonly string[]): Promise<CommandResult> =>
        await Promise.resolve(
          command.includes('clusterissuers.cert-manager.io')
            ? { exitCode: 1, stderr: 'error: the server doesn\'t have a resource type "clusterissuer"', stdout: '' }
            : result({ items: [] }),
        ),
    );

    await expect(readKubernetesInstallResourceInventory(input, 'production', 'compartment')).rejects.toThrow(
      /kubectl apply -f https:\/\/github\.com\/cert-manager\/cert-manager\/releases\/download\/v1\.21\.0\/cert-manager\.yaml/u,
    );
  });
});

function result(value: object): CommandResult {
  return { exitCode: 0, stderr: '', stdout: JSON.stringify(value) };
}

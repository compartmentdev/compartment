import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { readExistingKubernetesInstall } from '../src/services/kubernetes-install-release.service';
import { readRetainedKubernetesInstallState } from '../src/services/kubernetes-install-retained-state.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

type RunCommandWithTimeout = (command: readonly string[], timeoutMs: number) => Promise<CommandResult>;

const runCommandWithTimeout: Mock<RunCommandWithTimeout> = vi.hoisted(
  (): Mock<RunCommandWithTimeout> => vi.fn<RunCommandWithTimeout>(),
);

vi.mock('../src/command-runner', (): object => ({ runCommandWithTimeout }));

const input: KubernetesInstallDeploymentInput = {
  acmeEmail: 'owner@example.com',
  domainMode: 'custom',
  namespace: 'compartment',
  registryHostname: 'registry.example.test',
  registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'platform-issuer' },
  releaseName: 'compartment',
  valuesPath: '/tmp/values.yaml',
};

describe('existing Kubernetes install JSON', (): void => {
  afterEach((): void => {
    runCommandWithTimeout.mockReset();
  });

  it.each(['{', '{}'])('rejects an invalid Helm release list', async (output: string): Promise<void> => {
    runCommandWithTimeout.mockResolvedValue(successfulCommand(output));

    await expect(readExistingKubernetesInstall(input)).rejects.toThrow();
  });

  it('rejects non-object Helm values for a deployed release', async (): Promise<void> => {
    runCommandWithTimeout
      .mockResolvedValueOnce(successfulCommand(JSON.stringify([{ name: 'compartment', status: 'deployed' }])))
      .mockResolvedValueOnce(successfulCommand('[]'));

    await expect(readExistingKubernetesInstall(input)).rejects.toThrow();
  });
});

describe('retained Kubernetes install state JSON', (): void => {
  afterEach((): void => {
    runCommandWithTimeout.mockReset();
  });

  it('accepts an empty Secret list as absent retained state', async (): Promise<void> => {
    runCommandWithTimeout.mockResolvedValue(successfulCommand(JSON.stringify({ items: [], resourceVersion: '1' })));

    await expect(readRetainedKubernetesInstallState(input)).resolves.toBeNull();
  });

  it.each(['{', '[]', '{"items":{}}'])(
    'rejects invalid retained Secret list JSON',
    async (output: string): Promise<void> => {
      runCommandWithTimeout.mockResolvedValue(successfulCommand(output));

      await expect(readRetainedKubernetesInstallState(input)).rejects.toThrow();
    },
  );
});

function successfulCommand(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

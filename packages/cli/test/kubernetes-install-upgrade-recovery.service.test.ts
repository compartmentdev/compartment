import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { runKubernetesHelmInstallStage } from '../src/services/kubernetes-install-helm.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

type RunCommandWithTimeout = (command: readonly string[], timeoutMs: number) => Promise<CommandResult>;

const runCommandWithTimeout: Mock<RunCommandWithTimeout> = vi.hoisted(
  (): Mock<RunCommandWithTimeout> => vi.fn<RunCommandWithTimeout>(),
);

vi.mock('../src/command-runner', (): object => ({ runCommandWithTimeout }));

const input: KubernetesInstallDeploymentInput = {
  acmeEmail: 'owner@example.com',
  clearConfiguredIngressEndpoint: false,
  configuredIngressEndpoint: null,
  domainMode: 'custom',
  ingressClassName: 'traefik',
  kubeContext: 'production',
  namespace: 'compartment',
  registryHostname: 'registry.example.test',
  registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'platform-issuer' },
  releaseName: 'compartment',
  valuesPath: '/tmp/values.yaml',
};

describe('Kubernetes install upgrade recovery', (): void => {
  afterEach((): void => {
    runCommandWithTimeout.mockReset();
  });

  it('restores the pre-upgrade revision with a standalone rollback after an upgrade failure', async (): Promise<void> => {
    runCommandWithTimeout
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'upgrade failed', stdout: '' })
      .mockResolvedValueOnce(successfulCommand(''));

    await expect(runFailedUpgrade('full')).rejects.toThrow('Helm restored revision 3; the release is deployed again.');
    expect(runCommandWithTimeout.mock.calls[1]?.[0]).toEqual([
      'helm',
      'rollback',
      'compartment',
      '3',
      '--namespace',
      'compartment',
      '--wait',
      '--timeout',
      '8m',
      '--force-conflicts',
      '--kube-context',
      'production',
    ]);
  });

  it('prints the exact standalone rollback command when automatic recovery fails', async (): Promise<void> => {
    runCommandWithTimeout
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'upgrade failed', stdout: '' })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'rollback failed', stdout: '' });

    await expect(runFailedUpgrade('foundation')).rejects.toThrow(
      'Recover with `helm rollback compartment 3 --namespace compartment --wait --timeout 8m --force-conflicts --kube-context production`',
    );
  });
});

async function runFailedUpgrade(stage: 'foundation' | 'full'): Promise<void> {
  await runKubernetesHelmInstallStage(
    input,
    '/tmp/chart',
    '/tmp/platform-images.yaml',
    '/tmp/install-values.json',
    '/tmp/image-trust.yaml',
    stage,
    3,
  );
}

function successfulCommand(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { readExistingKubernetesInstall } from '../src/services/kubernetes-install-release.service';
import { readRetainedKubernetesInstallState } from '../src/services/kubernetes-install-retained-state.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  RetainedKubernetesInstallState,
} from '../src/services/kubernetes-install.service.types';

type RunCommandWithTimeout = (command: readonly string[], timeoutMs: number) => Promise<CommandResult>;

const runCommandWithTimeout: Mock<RunCommandWithTimeout> = vi.hoisted(
  (): Mock<RunCommandWithTimeout> => vi.fn<RunCommandWithTimeout>(),
);

vi.mock('../src/command-runner', (): object => ({ runCommandWithTimeout }));

const input: KubernetesInstallDeploymentInput = {
  acmeEmail: 'owner@example.com',
  chartFullname: 'compartment',
  clearConfiguredIngressEndpoint: false,
  configuredIngressEndpoint: null,
  domainMode: 'custom',
  ingressClassName: 'traefik',
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
      .mockResolvedValueOnce(
        successfulCommand(JSON.stringify([{ name: 'compartment', revision: '1', status: 'deployed' }])),
      )
      .mockResolvedValueOnce(successfulCommand('[]'));

    await expect(readExistingKubernetesInstall(input)).rejects.toThrow();
  });

  it('does not expose partial sensitive Helm values in lookup failures', async (): Promise<void> => {
    const encodedSecret: string = Buffer.from('install-token').toString('base64');
    runCommandWithTimeout
      .mockResolvedValueOnce(
        successfulCommand(JSON.stringify([{ name: 'compartment', revision: '1', status: 'deployed' }])),
      )
      .mockResolvedValueOnce({
        exitCode: 1,
        stderr: 'Kubernetes API request failed',
        stdout: JSON.stringify({ secrets: { installToken: encodedSecret } }),
      });

    const inspection: Promise<ExistingKubernetesInstall | null> = readExistingKubernetesInstall(input);
    await expect(inspection).rejects.toThrow('Kubernetes API request failed');
    await expect(inspection).rejects.not.toThrow(encodedSecret);
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

  it('does not expose a partial retained Secret payload in failures', async (): Promise<void> => {
    const encodedSecret: string = Buffer.from('managed-domain-acme-dns-token').toString('base64');
    runCommandWithTimeout.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (Forbidden)',
      stdout: JSON.stringify({ items: [{ data: { 'managed-domain-acme-dns-token': encodedSecret } }] }),
    });

    const inspection: Promise<RetainedKubernetesInstallState | null> = readRetainedKubernetesInstallState(input);
    await expect(inspection).rejects.toThrow('Error from server (Forbidden)');
    await expect(inspection).rejects.not.toThrow(encodedSecret);
    await expect(inspection).rejects.not.toThrow('managed-domain-acme-dns-token');
  });
});

function successfulCommand(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

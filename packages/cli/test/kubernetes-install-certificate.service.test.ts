import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { waitForKubernetesPlatformCertificates } from '../src/services/kubernetes-install-certificate.service';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
const runCommand: Mock<RunCommand> = vi.hoisted((): Mock<RunCommand> => vi.fn<RunCommand>());

vi.mock('../src/command-runner', (): object => ({
  runCommandWithTimeout: runCommand,
}));

describe('Kubernetes platform Certificate readiness', (): void => {
  afterEach((): void => {
    runCommand.mockReset();
  });

  it('keeps the installation incomplete when a Certificate is not Ready', async (): Promise<void> => {
    runCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'timed out waiting for the condition on certificates/compartment-console',
      stdout: '',
    });

    await expect(
      waitForKubernetesPlatformCertificates({
        acmeEmail: 'admin@example.com',
        domainMode: 'managed',
        namespace: 'compartment',
        registryHostname: 'registry.example.test',
        registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'platform-issuer' },
        releaseName: 'compartment',
        valuesPath: 'values.yaml',
      }),
    ).rejects.toThrow('Platform Certificate resources did not reach Ready=True; the installation remains incomplete');
  });
});

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';
import { readPendingKubernetesDomainTlsSecretName } from '../src/services/kubernetes-system-domain-release-values.service';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

const runCommand: Mock<RunCommand> = vi.hoisted((): Mock<RunCommand> => vi.fn<RunCommand>());

vi.mock('../src/command-runner', (): object => ({ runCommand }));

const target: KubernetesOperatorTarget = {
  namespace: 'compartment',
  releaseName: 'compartment',
};

describe('Kubernetes system-domain release values', (): void => {
  afterEach((): void => {
    runCommand.mockReset();
  });

  it('reads a pending TLS Secret from valid Helm values', async (): Promise<void> => {
    runCommand.mockResolvedValue(successfulCommand({ customTls: { pendingSecretName: 'domain-tls-pending' } }));

    await expect(readPendingKubernetesDomainTlsSecretName(target)).resolves.toBe('domain-tls-pending');
  });

  it.each([{ ignored: true }, { customTls: [] }])(
    'returns undefined when valid Helm values contain no custom TLS object',
    async (values: object): Promise<void> => {
      runCommand.mockResolvedValue(successfulCommand(values));

      await expect(readPendingKubernetesDomainTlsSecretName(target)).resolves.toBeUndefined();
    },
  );

  it.each(['{', '[]'])('rejects invalid Helm domain values', async (stdout: string): Promise<void> => {
    runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout });

    await expect(readPendingKubernetesDomainTlsSecretName(target)).rejects.toThrow();
  });
});

function successfulCommand(values: object): CommandResult {
  return { exitCode: 0, stderr: '', stdout: JSON.stringify(values) };
}

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';
import {
  readKubernetesHelmReleaseStatus,
  readKubernetesPlatformWorkloads,
} from '../src/services/kubernetes-system-status.service';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

const runCommand: Mock<RunCommand> = vi.hoisted((): Mock<RunCommand> => vi.fn<RunCommand>());

vi.mock('../src/command-runner', (): object => ({ runCommand }));

const target: KubernetesOperatorTarget = {
  namespace: 'compartment',
  releaseName: 'compartment',
};

describe('Kubernetes system status JSON', (): void => {
  afterEach((): void => {
    runCommand.mockReset();
  });

  it('accepts valid Helm status with unknown fields', async (): Promise<void> => {
    runCommand.mockResolvedValue(successfulCommand({ info: { status: 'deployed', unknown: true }, unknown: true }));

    await expect(readKubernetesHelmReleaseStatus(target)).resolves.toBe('deployed');
  });

  it('accepts serialized Helm release info', async (): Promise<void> => {
    runCommand.mockResolvedValue(successfulCommand({ info: JSON.stringify({ status: 'deployed' }) }));

    await expect(readKubernetesHelmReleaseStatus(target)).resolves.toBe('deployed');
  });

  it.each(['{', '[]'])('rejects invalid Helm status JSON', async (stdout: string): Promise<void> => {
    runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout });

    await expect(readKubernetesHelmReleaseStatus(target)).rejects.toThrow();
  });

  it.each(['{', '[]'])('rejects invalid serialized Helm release info', async (info: string): Promise<void> => {
    runCommand.mockResolvedValue(successfulCommand({ info }));

    await expect(readKubernetesHelmReleaseStatus(target)).rejects.toThrow();
  });

  it('accepts a valid workload list', async (): Promise<void> => {
    runCommand.mockResolvedValue(
      successfulCommand({
        items: [
          {
            kind: 'Deployment',
            metadata: { name: 'api' },
            spec: { replicas: 1 },
            status: { readyReplicas: 1 },
          },
        ],
        unknown: true,
      }),
    );

    await expect(readKubernetesPlatformWorkloads(target)).resolves.toEqual([
      { desiredReplicas: 1, kind: 'Deployment', name: 'api', ready: true, readyReplicas: 1 },
    ]);
  });

  it.each(['{', '{}', '{"items":{}}'])('rejects an invalid workload list', async (stdout: string): Promise<void> => {
    runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout });

    await expect(readKubernetesPlatformWorkloads(target)).rejects.toThrow();
  });
});

function successfulCommand(value: object): CommandResult {
  return { exitCode: 0, stderr: '', stdout: JSON.stringify(value) };
}

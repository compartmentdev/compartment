import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  KubernetesSystemRestartResponse,
  KubernetesSystemStatusResponse,
  KubernetesSystemUpdateResponse,
} from '@compartment/contracts';
import type { CommandResult } from '../src/command-runner.types';
import {
  getKubernetesSystemStatus,
  restartKubernetesSystem,
  updateKubernetesSystem,
} from '../src/services/kubernetes-system-lifecycle.service';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandCall = [command: readonly string[]];

interface VerifyUpdateInput {
  operatorValuesPaths: readonly string[];
  outputPath: string;
}

interface CapturedUpdateValues {
  images: { api: { digest: string; tag: string } };
}

type VerifyUpdateImages = (input: VerifyUpdateInput) => Promise<void>;

interface LifecycleMocks {
  runCommand: Mock<RunCommand>;
  verifyUpdateImages: Mock<VerifyUpdateImages>;
}

const mocks: LifecycleMocks = vi.hoisted(
  (): LifecycleMocks => ({ runCommand: vi.fn<RunCommand>(), verifyUpdateImages: vi.fn<VerifyUpdateImages>() }),
);

vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));
vi.mock('../src/services/kubernetes-image-trust.service', (): object => ({
  writeVerifiedKubernetesReleaseImageValues: mocks.verifyUpdateImages,
}));

describe('Kubernetes system lifecycle', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    mocks.verifyUpdateImages.mockReset();
  });

  it('combines Helm state with release-scoped Deployment and DaemonSet readiness', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(statusCommandHandler(false));

    const result: KubernetesSystemStatusResponse = await getKubernetesSystemStatus(target());

    expect(result).toMatchObject({ ready: false, releaseName: 'compartment-prod', releaseStatus: 'deployed' });
    expect(result.workloads).toEqual([
      { desiredReplicas: 2, kind: 'DaemonSet', name: 'logs', ready: false, readyReplicas: 1 },
      { desiredReplicas: 2, kind: 'Deployment', name: 'api', ready: true, readyReplicas: 2 },
    ]);
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.arrayContaining(['--selector', 'app.kubernetes.io/instance=compartment-prod']),
    );
  });

  it('restarts stateless Deployments including project-provisioner and excludes stateful infrastructure', async (): Promise<void> => {
    mocks.runCommand.mockImplementation(statusCommandHandler(true));

    const result: KubernetesSystemRestartResponse = await restartKubernetesSystem(target());

    expect(result.restarted).toBe(true);
    const commands: readonly (readonly string[])[] = mocks.runCommand.mock.calls.map(
      (call: RunCommandCall): readonly string[] => call[0],
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          'rollout',
          'restart',
          'deployment',
          '--selector',
          'app.kubernetes.io/instance=compartment-prod,app.kubernetes.io/component notin (postgres,registry)',
        ]),
        expect.arrayContaining([
          'rollout',
          'status',
          'deployment',
          '--selector',
          'app.kubernetes.io/instance=compartment-prod,app.kubernetes.io/component notin (postgres,registry)',
          '--timeout',
          '10m',
        ]),
      ]),
    );
    const rolloutCommands: readonly (readonly string[])[] = commands.filter((command: readonly string[]): boolean =>
      command.includes('rollout'),
    );
    expect(rolloutCommands).toHaveLength(2);
    expect(rolloutCommands).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['rollout', 'restart', 'deployment']),
        expect.arrayContaining(['rollout', 'status', 'deployment']),
      ]),
    );
  });

  it('verifies target tags before Helm and places immutable digest values last', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-update-test-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(valuesPath, '{}');
      const events: string[] = [];
      mocks.verifyUpdateImages.mockImplementation(async (input: VerifyUpdateInput): Promise<void> => {
        events.push('verify');
        const updateValuesPath: string | undefined = input.operatorValuesPaths[1];
        if (updateValuesPath === undefined) {
          throw new Error('Expected update values path.');
        }
        const updateValues: CapturedUpdateValues = JSON.parse(
          await readFile(updateValuesPath, 'utf8'),
        ) as CapturedUpdateValues;
        expect(updateValues.images.api).toEqual({ digest: '', tag: 'sha-target' });
        await writeFile(input.outputPath, JSON.stringify({ images: { api: { digest: `sha256:${'a'.repeat(64)}` } } }));
      });
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        if (command[0] === 'helm' && command[1] === 'upgrade') {
          events.push('helm');
          const valuesIndexes: number[] = command.flatMap((value: string, index: number): number[] =>
            value === '--values' ? [index] : [],
          );
          const lastValuesPath: string | undefined = command[(valuesIndexes.at(-1) ?? -2) + 1];
          expect(lastValuesPath).toContain('image-trust-values.json');
          expect(command).toEqual(
            expect.arrayContaining([
              '--reset-then-reuse-values',
              '--rollback-on-failure',
              '--wait',
              '--wait-for-jobs',
              '--timeout',
              '15m',
            ]),
          );
          expect(command).not.toContain('--reuse-values');
          return successful('');
        }
        return await statusCommandHandler(true)(command);
      });

      const result: KubernetesSystemUpdateResponse = await updateKubernetesSystem({
        ...target(),
        chartPath: resolve(directory, 'chart'),
        valuesPath,
        version: 'sha-target',
      });

      expect(events).toEqual(['verify', 'helm']);
      expect(result).toMatchObject({ updated: true, version: 'sha-target' });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('stops before Helm when image trust verification fails', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-update-test-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(valuesPath, '{}');
      mocks.verifyUpdateImages.mockRejectedValue(new Error('image signature rejected'));

      await expect(
        updateKubernetesSystem({
          ...target(),
          chartPath: resolve(directory, 'chart'),
          valuesPath,
          version: 'sha-target',
        }),
      ).rejects.toThrow('image signature rejected');
      expect(mocks.runCommand).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('surfaces Helm rollback-on-failure errors without compatibility fallback logic', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-update-test-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(valuesPath, '{}');
      mocks.verifyUpdateImages.mockImplementation(
        async (input: VerifyUpdateInput): Promise<void> => await writeFile(input.outputPath, '{}'),
      );
      mocks.runCommand.mockResolvedValue({ exitCode: 1, stderr: 'release rolled back', stdout: '' });

      await expect(
        updateKubernetesSystem({
          ...target(),
          chartPath: resolve(directory, 'chart'),
          valuesPath,
          version: 'sha-target',
        }),
      ).rejects.toThrow('Helm platform update failed: release rolled back');
      expect(mocks.runCommand).toHaveBeenCalledWith(expect.arrayContaining(['--rollback-on-failure']));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function target(): KubernetesOperatorTarget {
  return { kubeContext: 'prod', namespace: 'compartment', releaseName: 'compartment-prod' };
}

function statusCommandHandler(ready: boolean): RunCommand {
  return async (command: readonly string[]): Promise<CommandResult> => {
    await Promise.resolve();
    if (command[0] === 'helm' && command[1] === 'status') {
      return successful(JSON.stringify({ info: { status: 'deployed' }, name: 'compartment-prod' }));
    }
    if (command[0] === 'kubectl' && command.includes('get')) {
      return successful(
        JSON.stringify({
          items: [
            { kind: 'Deployment', metadata: { name: 'api' }, spec: { replicas: 2 }, status: { readyReplicas: 2 } },
            {
              kind: 'DaemonSet',
              metadata: { name: 'logs' },
              status: { desiredNumberScheduled: 2, numberReady: ready ? 2 : 1 },
            },
          ],
        }),
      );
    }
    if (command[0] === 'kubectl' && command.includes('rollout')) {
      return successful('');
    }
    throw new Error(`Unexpected command: ${command.join(' ')}`);
  };
}

function successful(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

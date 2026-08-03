import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { KubernetesSystemRestartResponse, KubernetesSystemStatusResponse } from '@compartment/contracts';
import type { CommandResult } from '../src/command-runner.types';
import {
  getKubernetesSystemStatus,
  restartKubernetesSystem,
} from '../src/services/kubernetes-system-lifecycle.service';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandCall = [command: readonly string[]];

interface LifecycleMocks {
  runCommand: Mock<RunCommand>;
}

const mocks: LifecycleMocks = vi.hoisted((): LifecycleMocks => ({ runCommand: vi.fn<RunCommand>() }));

vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));

describe('Kubernetes system lifecycle', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
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

import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import { inspectKubernetesBuildRuntime } from '../src/services/kubernetes-build-runtime-preflight.service';
import type {
  KubernetesBuildRuntimeAssessment,
  KubernetesBuildRuntimePreflightInput,
  KubernetesRuntimeClassItem,
} from '../src/services/kubernetes-build-runtime-preflight.service.types';

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('Kubernetes build RuntimeClass preflight', (): void => {
  it('accepts a configured RuntimeClass that exists', async (): Promise<void> => {
    mockRuntimeClasses([{ handler: 'runsc', metadata: { name: 'gvisor' } }]);

    await expect(inspectKubernetesBuildRuntime(input('gvisor'))).resolves.toEqual({
      detail: 'Build RuntimeClass "gvisor" exists in the cluster.',
      kind: 'configured',
    });
  });

  it('rejects a configured RuntimeClass that does not exist', async (): Promise<void> => {
    mockRuntimeClasses([]);

    await expect(inspectKubernetesBuildRuntime(input('missing'))).rejects.toThrow(
      'Build RuntimeClass "missing" was requested but does not exist in the cluster.',
    );
  });

  it('suggests an available gVisor RuntimeClass without selecting it', async (): Promise<void> => {
    mockRuntimeClasses([{ handler: 'runsc', metadata: { name: 'gke-gvisor' } }]);

    await expect(inspectKubernetesBuildRuntime(input(''))).resolves.toEqual({
      detail:
        'Optional gVisor RuntimeClass "gke-gvisor" was found. To sandbox source builds with it, set buildkit.runtimeClassName=gke-gvisor in the install values.',
      kind: 'discovered',
    });
  });

  it('warns and continues when no gVisor RuntimeClass exists', async (): Promise<void> => {
    mockRuntimeClasses([{ handler: 'runc', metadata: { name: 'native' } }]);

    const assessment: KubernetesBuildRuntimeAssessment = await inspectKubernetesBuildRuntime(input(''));
    expect(assessment.kind).toBe('default-runtime');
    expect(assessment.detail).toContain('source builds will run without the optional gVisor sandbox');
  });

  it('warns and continues when RuntimeClass listing is forbidden', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (Forbidden)',
      stdout: '',
    });

    const assessment: KubernetesBuildRuntimeAssessment = await inspectKubernetesBuildRuntime(input('gvisor'));
    expect(assessment.kind).toBe('unverified');
    expect(assessment.detail).toContain('current credentials cannot list node.k8s.io/runtimeclasses');
  });
});

function input(runtimeClassName: string): KubernetesBuildRuntimePreflightInput {
  return {
    kubeContext: 'cluster',
    kubeconfigPath: '/tmp/kubeconfig',
    runtimeClassName,
  };
}

function mockRuntimeClasses(items: KubernetesRuntimeClassItem[]): void {
  mockedRunCommand.mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({ items }),
  });
}

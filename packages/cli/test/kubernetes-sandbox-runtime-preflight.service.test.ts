import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand, runCommandWithInput, runCommandWithTimeout } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import { verifyKubernetesSandboxRuntime } from '../src/services/kubernetes-sandbox-runtime-preflight.service';
import type { KubernetesSandboxRuntimePreflightInput } from '../src/services/kubernetes-sandbox-runtime-preflight.service.types';

vi.mock('../src/command-runner', (): object => ({
  runCommand: vi.fn(),
  runCommandWithInput: vi.fn(),
  runCommandWithTimeout: vi.fn(),
}));
vi.mock('../src/services/kubernetes-ready-nodes.service', (): object => ({
  readReadyKubernetesNodeNames: vi.fn(async (): Promise<string[]> => await Promise.resolve(['node-a', 'node-b'])),
}));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);
const mockedRunCommandWithInput: MockedFunction<typeof runCommandWithInput> = vi.mocked(runCommandWithInput);
const mockedRunCommandWithTimeout: MockedFunction<typeof runCommandWithTimeout> = vi.mocked(runCommandWithTimeout);

describe('Kubernetes sandbox RuntimeClass preflight', (): void => {
  beforeEach((): void => {
    mockedRunCommand.mockResolvedValue(success('{}'));
    mockedRunCommandWithInput.mockResolvedValue(success(''));
    mockedRunCommandWithTimeout.mockResolvedValue(success('[    0.000000] Starting gVisor...'));
  });

  afterEach((): void => {
    vi.clearAllMocks();
  });

  it('runs a real Pod and verifies the gVisor kernel boundary', async (): Promise<void> => {
    await expect(verifyKubernetesSandboxRuntime(input('gke-gvisor'))).resolves.toEqual({
      detail: 'Verified gVisor sandbox through RuntimeClass "gke-gvisor" on 2 Ready node(s).',
      runtimeClassName: 'gke-gvisor',
    });
  });

  it('fails closed when no sandbox RuntimeClass is configured', async (): Promise<void> => {
    await expect(verifyKubernetesSandboxRuntime(input(''))).rejects.toThrow(
      'No Kubernetes sandbox RuntimeClass is configured',
    );
  });

  it('fails closed with operator instructions when the RuntimeClass is missing', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValue({ exitCode: 1, stderr: 'NotFound', stdout: '' });

    await expect(verifyKubernetesSandboxRuntime(input('gvisor'))).rejects.toThrow(
      'Install gVisor on every eligible build and tenant node',
    );
  });

  it('rejects a RuntimeClass that starts the canary with the host kernel', async (): Promise<void> => {
    mockedRunCommandWithTimeout
      .mockResolvedValueOnce(success(''))
      .mockResolvedValueOnce(success('Linux host kernel log'))
      .mockResolvedValueOnce(success(''));

    await expect(verifyKubernetesSandboxRuntime(input('native'))).rejects.toThrow(
      'did not expose the gVisor kernel log',
    );
  });
});

function input(runtimeClassName: string): KubernetesSandboxRuntimePreflightInput {
  return { kubeContext: 'cluster', kubeconfigPath: '/tmp/kubeconfig', runtimeClassName };
}

function success(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

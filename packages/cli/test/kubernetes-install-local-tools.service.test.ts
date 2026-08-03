import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCli } from '../src/app';
import { runCommand } from '../src/command-runner';
import { assertKubernetesInstallLocalTools } from '../src/services/kubernetes-install-local-tools.service';
import { withKubernetesLocalTools } from '../src/services/kubernetes-local-tools.service';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

describe('Kubernetes install local tool preflight', (): void => {
  beforeEach((): void => {
    mockedRunCommand.mockReset();
  });

  it('fails immediately with Helm 4 installation guidance when helm is missing', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce(successfulKubectlVersion()).mockResolvedValueOnce({
      exitCode: 127,
      failure: { command: 'helm', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm not found on PATH.*Install Helm >= 4\.0\.0.*get-helm-4.*re-run the command/su,
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it('reports missing kubectl before checking Helm', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({
      exitCode: 127,
      failure: { command: 'kubectl', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /kubectl not found on PATH.*Install kubectl >= 1\.30\.0/su,
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('reports an old kubectl version precisely', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ clientVersion: { gitVersion: 'v1.29.9' } }),
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /kubectl v1\.29\.9 is installed, but kubectl >= 1\.30\.0 is required/su,
    );
  });

  it('reports a broken kubectl version response precisely', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'not json' });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow('kubectl returned an invalid version response');
  });

  it('reports both the detected and required Helm versions', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce(successfulKubectlVersion()).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'v3.21.3+g1ad6e68',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm v3\.21\.3\+g1ad6e68 is installed, but helm >= 4\.0\.0 is required.*get-helm-4/su,
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it('rejects a Helm prerelease below the stable minimum', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce(successfulKubectlVersion()).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'v4.0.0-rc.1+g1234567',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm v4\.0\.0-rc\.1\+g1234567 is installed, but helm >= 4\.0\.0 is required/su,
    );
  });

  it('reports a broken Helm version response precisely', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce(successfulKubectlVersion())
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'development' });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm returned an unsupported version "development".*Install Helm >= 4\.0\.0/su,
    );
  });

  it('accepts the canonical Helm and kubectl versions without changing the install path', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce(successfulKubectlVersion())
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'v4.2.3+gdbd5f13' });

    await expect(assertKubernetesInstallLocalTools()).resolves.toBeUndefined();
    expect(mockedRunCommand).toHaveBeenNthCalledWith(1, ['kubectl', 'version', '--client', '--output=json']);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(2, ['helm', 'version', '--template', '{{.Version}}']);
  });

  it('reports the product Helm remediation before system restart when Helm is missing', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce(successfulKubectlVersion()).mockResolvedValueOnce({
      exitCode: 127,
      failure: { command: 'helm', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    });
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['system', 'restart'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toMatch(/helm not found on PATH.*Install Helm >= 4\.0\.0/su);
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it('reports detected and required Helm versions before system restart with Helm 3', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce(successfulKubectlVersion()).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'v3.21.3+g1ad6e68',
    });
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['system', 'restart'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('helm v3.21.3+g1ad6e68 is installed, but helm >= 4.0.0 is required.');
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the tool gate inside one wrapped Kubernetes command', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce(successfulKubectlVersion())
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'v4.2.3' });

    await withKubernetesLocalTools(
      async (): Promise<void> =>
        await withKubernetesLocalTools(async (): Promise<void> => {
          await Promise.resolve();
        }),
    );

    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });
});

function successfulKubectlVersion(): { exitCode: number; stderr: string; stdout: string } {
  return {
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({ clientVersion: { gitVersion: 'v1.33.2' } }),
  };
}

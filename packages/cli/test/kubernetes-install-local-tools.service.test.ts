import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import { assertKubernetesInstallLocalTools } from '../src/services/kubernetes-install-local-tools.service';

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

describe('Kubernetes install local tool preflight', (): void => {
  beforeEach((): void => {
    mockedRunCommand.mockReset();
  });

  it('fails immediately with Helm 4 installation guidance when helm is missing', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({
      exitCode: 127,
      failure: { command: 'helm', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm not found on PATH.*Install Helm >= 4\.0\.0.*get-helm-4.*re-run install/su,
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('reports both the detected and required Helm versions', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'v3.21.3+g1ad6e68',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm v3\.21\.3\+g1ad6e68 is installed, but helm >= 4\.0\.0 is required.*get-helm-4/su,
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects a Helm prerelease below the stable minimum', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'v4.0.0-rc.1+g1234567',
    });

    await expect(assertKubernetesInstallLocalTools()).rejects.toThrow(
      /helm v4\.0\.0-rc\.1\+g1234567 is installed, but helm >= 4\.0\.0 is required/su,
    );
  });

  it('accepts the canonical Helm and kubectl versions without changing the install path', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'v4.2.3+gdbd5f13' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ clientVersion: { gitVersion: 'v1.33.2' } }),
      });

    await expect(assertKubernetesInstallLocalTools()).resolves.toBeUndefined();
    expect(mockedRunCommand).toHaveBeenNthCalledWith(1, ['helm', 'version', '--template', '{{.Version}}']);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(2, ['kubectl', 'version', '--client', '--output=json']);
  });
});

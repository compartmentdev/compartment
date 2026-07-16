import { readFile, stat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { deployAndWaitForKubernetesInstall } from '../src/services/kubernetes-install.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
} from '../src/services/kubernetes-install.service.types';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandCall = [command: readonly string[]];

interface KubernetesInstallServiceMocks {
  runCommand: Mock<RunCommand>;
}

interface InstallSecretValues {
  secrets: {
    installToken: string;
  };
}

const mocks: KubernetesInstallServiceMocks = vi.hoisted(
  (): KubernetesInstallServiceMocks => ({ runCommand: vi.fn<RunCommand>() }),
);

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
}));

const deploymentInput: KubernetesInstallDeploymentInput = {
  apiUrl: 'https://console.apps.example.com',
  baseDomain: 'apps.example.com',
  chartPath: '/tmp/compartment-chart',
  namespace: 'compartment',
  releaseName: 'compartment',
  valuesPath: '/tmp/compartment-values.yaml',
};

describe('Kubernetes install deployment', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('installs foundation and full with one temporary install token', async (): Promise<void> => {
    const installTokens: string[] = [];
    const installValueModes: number[] = [];
    const installValuePaths: string[] = [];
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      if (command[1] === 'list') {
        return successfulCommandResult('[]');
      }
      const installValuesPath: string = readLastOptionValue(command, '--values');
      const values: InstallSecretValues = JSON.parse(await readFile(installValuesPath, 'utf8')) as InstallSecretValues;
      installTokens.push(readInstallToken(values));
      installValueModes.push((await stat(installValuesPath)).mode & 0o777);
      installValuePaths.push(installValuesPath);
      return successfulCommandResult('');
    });
    stubReadyControlPlane();

    const result: { installToken: string } = await deployAndWaitForKubernetesInstall(deploymentInput);
    expect(readHelmStages()).toEqual(['foundation', 'full']);
    expect(installTokens).toHaveLength(2);
    expect(installTokens[0]).toMatch(/^[\da-f]{64}$/u);
    expect(installTokens[1]).toBe(installTokens[0]);
    expect(result.installToken).toBe(installTokens[0]);
    expect(installValueModes).toEqual([0o600, 0o600]);
    expect(readCommandText()).not.toContain(installTokens[0]);
    await expect(readFile(installValuePaths[0]!, 'utf8')).rejects.toThrow();
  });

  it('resumes a foundation release with its existing install token', async (): Promise<void> => {
    let fullInstallToken: string | null = null;
    mocks.runCommand
      .mockResolvedValueOnce(successfulCommandResult(deployedReleaseList()))
      .mockResolvedValueOnce(successfulCommandResult(existingInstallValues('foundation')))
      .mockImplementationOnce(async (command: readonly string[]): Promise<CommandResult> => {
        const values: InstallSecretValues = JSON.parse(
          await readFile(readLastOptionValue(command, '--values'), 'utf8'),
        ) as InstallSecretValues;
        fullInstallToken = readInstallToken(values);
        return successfulCommandResult('');
      });
    stubReadyControlPlane();

    await expect(deployAndWaitForKubernetesInstall(deploymentInput)).resolves.toEqual({
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['full']);
    expect(fullInstallToken).toBe('existing-install-token');
  });

  it('removes temporary secret values after a Helm failure without leaking the token', async (): Promise<void> => {
    let installToken: string | null = null;
    let installValuesPath: string | null = null;
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      if (command[1] === 'list') {
        return successfulCommandResult('[]');
      }
      installValuesPath = readLastOptionValue(command, '--values');
      const values: InstallSecretValues = JSON.parse(await readFile(installValuesPath, 'utf8')) as InstallSecretValues;
      installToken = readInstallToken(values);
      return readLastOptionValue(command, '--set') === 'platform.startupStage=foundation'
        ? successfulCommandResult('')
        : { exitCode: 1, stderr: 'upgrade failed', stdout: '' };
    });

    await expect(deployAndWaitForKubernetesInstall(deploymentInput)).rejects.toThrow('upgrade failed');
    expect(installToken).toMatch(/^[\da-f]{64}$/u);
    expect(readCommandText()).not.toContain(installToken);
    await expect(readFile(installValuesPath!, 'utf8')).rejects.toThrow();
  });

  it('resumes owner bootstrap without downgrading an existing full release', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(successfulCommandResult(deployedReleaseList()))
      .mockResolvedValueOnce(successfulCommandResult(existingInstallValues('full')));
    stubReadyControlPlane();

    await expect(deployAndWaitForKubernetesInstall(deploymentInput)).resolves.toEqual({
      installToken: 'existing-install-token',
    });
    expect(mocks.runCommand.mock.calls.map((call: RunCommandCall): readonly string[] => call[0])).toEqual([
      ['helm', 'list', '--namespace', 'compartment', '--filter', '^compartment$', '--output', 'json'],
      ['helm', 'get', 'values', 'compartment', '--namespace', 'compartment', '--all', '--output', 'json'],
    ]);
  });

  it.each(['failed', 'pending-upgrade', 'uninstalled'])(
    'rejects a Helm release with status %s instead of treating it as resumable',
    async (status: string): Promise<void> => {
      mocks.runCommand.mockResolvedValueOnce(successfulCommandResult(helmReleaseList(status)));

      await expect(deployAndWaitForKubernetesInstall(deploymentInput)).rejects.toThrow(
        `existing Helm release compartment has status ${status}`,
      );
      expect(mocks.runCommand).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a resume request for another base domain', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(successfulCommandResult(deployedReleaseList()))
      .mockResolvedValueOnce(successfulCommandResult(existingInstallValues('full', 'other.example.com')));
    stubReadyControlPlane();

    await expect(deployAndWaitForKubernetesInstall(deploymentInput)).rejects.toThrow(
      'uses base domain other.example.com, not apps.example.com',
    );
  });

  it('fails closed when a full release has no resumable install token', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(successfulCommandResult(deployedReleaseList()))
      .mockResolvedValueOnce(
        successfulCommandResult(
          JSON.stringify({ platform: { baseDomain: 'apps.example.com', startupStage: 'full' }, secrets: {} }),
        ),
      );

    await expect(deployAndWaitForKubernetesInstall(deploymentInput)).rejects.toThrow('has no resumable install token');
  });

  it('waits for the Compartment login boundary and releases rejected response bodies', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce(successfulCommandResult(deployedReleaseList()))
      .mockResolvedValueOnce(successfulCommandResult(existingInstallValues('full')));
    const placeholderResponse: Response = new Response('not compartment', { status: 200 });
    const fetchMock: Mock<() => Promise<Response>> = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(placeholderResponse)
      .mockResolvedValueOnce(readyControlPlaneResponse());
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const installPromise: Promise<KubernetesInstallDeploymentResult> =
      deployAndWaitForKubernetesInstall(deploymentInput);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(installPromise).resolves.toEqual({ installToken: 'existing-install-token' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(placeholderResponse.bodyUsed).toBe(true);
  });
});

function readHelmStages(): string[] {
  return mocks.runCommand.mock.calls
    .map((call: RunCommandCall): readonly string[] => call[0])
    .filter((command: readonly string[]): boolean => command[1] === 'upgrade')
    .map((command: readonly string[]): string => readLastOptionValue(command, '--set').split('=')[1]!);
}

function readCommandText(): string {
  return mocks.runCommand.mock.calls.flatMap((call: RunCommandCall): readonly string[] => call[0]).join('\n');
}

function readLastOptionValue(command: readonly string[], option: string): string {
  const optionIndex: number = command.lastIndexOf(option);
  const value: string | undefined = command[optionIndex + 1];
  if (optionIndex < 0 || value === undefined) {
    throw new Error(`Missing ${option} in command.`);
  }
  return value;
}

function readInstallToken(value: InstallSecretValues): string {
  return value.secrets.installToken;
}

function helmReleaseList(status: string): string {
  return JSON.stringify([{ name: 'compartment', status }]);
}

function deployedReleaseList(): string {
  return helmReleaseList('deployed');
}

function existingInstallValues(stage: 'foundation' | 'full', baseDomain: string = 'apps.example.com'): string {
  return JSON.stringify({
    platform: { baseDomain, startupStage: stage },
    secrets: { installToken: 'existing-install-token' },
  });
}

function stubReadyControlPlane(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
  );
}

function readyControlPlaneResponse(): Response {
  return new Response(null, { headers: { location: '/login' }, status: 302 });
}

function successfulCommandResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

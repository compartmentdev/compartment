import type { PathLike } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { expectCliSuccess, readCliStdout, runCliCommand, type CliCommandResult } from './cli-test.harness';

type ReadTextFile = (path: PathLike, encoding: string) => Promise<string>;
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type ImportOriginal = () => Promise<object>;

interface SystemKubeconfigMocks {
  readFile: Mock<ReadTextFile>;
  runCommand: Mock<RunCommand>;
}

const mocks: SystemKubeconfigMocks = vi.hoisted(
  (): SystemKubeconfigMocks => ({
    readFile: vi.fn<ReadTextFile>(),
    runCommand: vi.fn<RunCommand>(),
  }),
);

vi.mock('node:fs/promises', async (importOriginal: ImportOriginal): Promise<object> => {
  const original: object = await importOriginal();
  return { ...original, readFile: mocks.readFile };
});

vi.mock('../src/command-runner', async (importOriginal: ImportOriginal): Promise<object> => {
  const original: object = await importOriginal();
  return { ...original, runCommand: mocks.runCommand };
});

const k3sKubeconfigPath: string = '/etc/rancher/k3s/k3s.yaml';
const kubeconfigContents: string = `
apiVersion: v1
clusters:
  - name: local
    cluster:
      server: https://127.0.0.1:6443
contexts:
  - name: local
    context:
      cluster: local
current-context: local
`;

describe('system command kubeconfig resolution', (): void => {
  let originalKubeconfig: string | undefined;

  beforeEach((): void => {
    originalKubeconfig = process.env.KUBECONFIG;
    delete process.env.KUBECONFIG;
    mocks.readFile.mockReset();
    mocks.runCommand.mockReset();
  });

  afterEach((): void => {
    if (originalKubeconfig === undefined) {
      delete process.env.KUBECONFIG;
    } else {
      process.env.KUBECONFIG = originalKubeconfig;
    }
  });

  it('uses the readable k3s kubeconfig when KUBECONFIG and the home config are absent', async (): Promise<void> => {
    mocks.readFile.mockImplementation(async (path: PathLike): Promise<string> => {
      if (String(path) === k3sKubeconfigPath) {
        return await Promise.resolve(kubeconfigContents);
      }
      return await Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    });
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      if (command[0] === 'helm' && command[1] === 'version') {
        return await Promise.resolve({ exitCode: 0, stderr: '', stdout: 'v4.0.0' });
      }
      if (command[0] === 'kubectl' && command[1] === 'version') {
        return await Promise.resolve(successfulCommand({ clientVersion: { gitVersion: 'v1.30.0' } }));
      }
      if (command[0] === 'helm') {
        return await Promise.resolve(successfulCommand({ info: { status: 'deployed' } }));
      }
      return await Promise.resolve(
        successfulCommand({
          items: [
            {
              kind: 'Deployment',
              metadata: { name: 'api' },
              spec: { replicas: 1 },
              status: { readyReplicas: 1 },
            },
          ],
        }),
      );
    });

    const result: CliCommandResult = await runCliCommand(['system', 'status']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Platform readiness: ready.');
    expect(mocks.runCommand).toHaveBeenCalledTimes(4);
    for (const [command] of mocks.runCommand.mock.calls.slice(2)) {
      expect(command).toEqual(expect.arrayContaining(['--kubeconfig', k3sKubeconfigPath]));
    }
  });
});

function successfulCommand(value: object): CommandResult {
  return { exitCode: 0, stderr: '', stdout: JSON.stringify(value) };
}

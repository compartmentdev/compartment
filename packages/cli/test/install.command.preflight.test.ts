import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCli } from '../src/app';
import { runCommand } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import type { CliCommandDependencies } from '../src/commands/command.types';
import { runInstallPreflightChecklist } from '../src/commands/install/install.command.preflight';
import type { KubernetesInstallTargetOptions } from '../src/commands/install/install.command.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);
const originalKubeconfig: string | undefined = process.env.KUBECONFIG;

afterEach((): void => {
  vi.clearAllMocks();
  if (originalKubeconfig === undefined) {
    delete process.env.KUBECONFIG;
  } else {
    process.env.KUBECONFIG = originalKubeconfig;
  }
});

describe.sequential('install preflight warnings', (): void => {
  it('prints a kubeconfig failure exactly once', async (): Promise<void> => {
    process.env.KUBECONFIG = '/nonexistent/compartment-install-ux-missing.yaml';
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);

    expect(exitCode).toBe(1);
    expect(countOccurrences(readCliStderr(capture), 'not found')).toBe(1);
    expect(readCliStderr(capture)).toContain('✗ kubeconfig:');
  });

  it('prints a cluster failure exactly once', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 127, stderr: 'spawn kubectl ENOENT', stdout: '' });
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);

    expect(exitCode).toBe(1);
    expect(countOccurrences(readCliStderr(capture), 'kubectl is not installed or not on PATH.')).toBe(1);
    expect(readCliStderr(capture)).toContain('✗ cluster:');
  });

  it('passes install preflight without inspecting host ports when Traefik is present', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    const traefikServices: string =
      '{"items":[{"metadata":{"name":"traefik","namespace":"kube-system"},"spec":{"type":"LoadBalancer","ports":[{"port":80},{"port":443}]}}]}';
    mockedRunCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      const renderedCommand: string = command.join(' ');
      if (renderedCommand.includes('get services')) {
        return await Promise.resolve({ exitCode: 0, stderr: '', stdout: traefikServices });
      }
      return await Promise.resolve({
        exitCode: 0,
        stderr: '',
        stdout: renderedCommand.includes('get storageclass') ? '{"items":[]}' : '{}',
      });
    });
    const capture: CliCommandCapture = createCliCapture();

    await expect(runInstallPreflightChecklist(dependencies(capture), target(), true)).resolves.toMatchObject({
      preflight: { storageClass: '' },
    });
    const stderr: string = readCliStderr(capture);
    const commands: string = mockedRunCommand.mock.calls
      .map((call: [command: readonly string[], env?: NodeJS.ProcessEnv | undefined]): string => call[0].join(' '))
      .join('\n');
    expect(stderr).toContain('✓ cluster: reachable');
    expect(stderr).not.toContain('ingress ports');
    expect(commands).not.toContain('services');
    expect(commands).not.toContain('daemonsets');
  });

  it('prints a storage class failure exactly once', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'forbidden', stdout: '' });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    await expect(runInstallPreflightChecklist(dependencies(capture), target(), true)).rejects.toThrow(
      'Cannot inspect Kubernetes storage classes.',
    );
    const stderr: string = readCliStderr(capture);

    expect(countOccurrences(stderr, 'Cannot inspect Kubernetes storage classes.')).toBe(1);
    expect(stderr).toContain('✗ storage class:');
  });
});

function target(): KubernetesInstallTargetOptions {
  return { namespace: 'compartment', releaseName: 'compartment' };
}

function dependencies(capture: CliCommandCapture): CliCommandDependencies {
  return { argv: [], commandPrefix: [], io: capture.io };
}

async function createUsableKubeconfig(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-install-preflight-'));
  const path: string = join(directory, 'config.yaml');
  await writeFile(
    path,
    'clusters:\n  - name: default\n    cluster:\n      server: https://cluster.example.test:6443\ncontexts:\n  - name: default\n    context:\n      cluster: default\ncurrent-context: default\n',
  );
  return path;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

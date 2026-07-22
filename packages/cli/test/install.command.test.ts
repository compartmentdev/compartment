import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCli } from '../src/app';
import { runCommand } from '../src/command-runner';
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

describe.sequential('install command boundary', (): void => {
  it('explains minimal values without waiting for input when no TTY is available', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' });
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--values is required when running non-interactively.');
    expect(readCliStderr(capture)).toContain('storage:\n  storageClass: local-path');
    expect(readCliStderr(capture)).toContain('interactive terminal for the guided setup');
  });

  it('reports an unreachable cluster before any configuration or owner question', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig('https://10.0.0.2:6443');
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 1, stderr: 'connection refused', stdout: '' });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install'], capture.io);
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('✗ cluster: Cannot reach Kubernetes cluster at https://10.0.0.2:6443.');
    expect(stderr).not.toContain('Domain:');
    expect(stderr).not.toContain('Admin email:');
    expect(stderr).not.toContain('connection refused');
  });

  it('keeps Kubernetes deployment options out of the dev install path', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(
      ['install', '--dev', '--api-url', 'https://console.apps.example.com'],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--dev cannot be combined with --api-url.');
  });

  it('rejects the removed local Docker runtime option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--local-runtime'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain("unknown option '--local-runtime'");
  });
});

async function createUsableKubeconfig(server: string = 'https://127.0.0.1:6443'): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-install-command-'));
  const path: string = join(directory, 'config.yaml');
  await writeFile(
    path,
    `clusters:\n  - name: default\n    cluster:\n      server: ${server}\ncontexts:\n  - name: default\n    context:\n      cluster: default\ncurrent-context: default\n`,
  );
  return path;
}

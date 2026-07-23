import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCli } from '../src/app';
import { runCommand } from '../src/command-runner';
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

  it('prints an ingress port failure exactly once', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout:
          '{"items":[{"metadata":{"name":"nginx","namespace":"ingress-nginx"},"spec":{"ports":[{"port":443}],"type":"LoadBalancer"}}]}',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: '{"items":[{"metadata":{"name":"svclb-nginx-abcd"}}]}',
      });
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(1);
    expect(countOccurrences(stderr, 'Ports 80/443 are already taken')).toBe(1);
    expect(stderr).toContain('✗ ingress ports:');
  });

  it('prints a storage class failure exactly once', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'forbidden', stdout: '' });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install'], capture.io);
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(1);
    expect(countOccurrences(stderr, 'Cannot inspect Kubernetes storage classes.')).toBe(1);
    expect(stderr).toContain('✗ storage class:');
  });

  it('requires confirmation before a guided install continues past a cloud LoadBalancer warning', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockCloudLoadBalancerConflict();
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('yes\n');

    await expect(runInstallPreflightChecklist(dependencies(capture), target(), false, true)).resolves.toMatchObject({
      preflight: { ingressWarning: { name: 'nginx', namespace: 'ingress-nginx' } },
    });
    expect(readCliStderr(capture)).toContain('Continue installation?');
  });

  it('only warns and never prompts on the explicit values path', async (): Promise<void> => {
    process.env.KUBECONFIG = await createUsableKubeconfig();
    mockCloudLoadBalancerConflict();
    const capture: CliCommandCapture = createCliCapture();

    await expect(runInstallPreflightChecklist(dependencies(capture), target(), false, false)).resolves.toMatchObject({
      preflight: { ingressWarning: { name: 'nginx', namespace: 'ingress-nginx' } },
    });
    const stderr: string = readCliStderr(capture);
    expect(stderr).toContain('This can coexist when LoadBalancer Services receive separate addresses.');
    expect(stderr).not.toContain('Continue installation?');
    expect(stderr).not.toContain('disable Traefik');
  });
});

function mockCloudLoadBalancerConflict(): void {
  mockedRunCommand
    .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
    .mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout:
        '{"items":[{"metadata":{"name":"nginx","namespace":"ingress-nginx"},"spec":{"ports":[{"port":443}],"type":"LoadBalancer"}}]}',
    })
    .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' });
}

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

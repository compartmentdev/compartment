import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import { buildHelmCommand, buildKubectlCommand } from '../src/services/kubernetes-command.support';
import { resolveKubernetesInstallKubeconfig } from '../src/services/kubernetes-install-kubeconfig.service';
import type { ResolvedKubernetesKubeconfig } from '../src/services/kubernetes-install-kubeconfig.service.types';
import { runKubernetesInstallPreflight } from '../src/services/kubernetes-install-preflight.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';
import type { KubernetesInstallPreflightInput } from '../src/services/kubernetes-install-preflight.service.types';

interface FileSystemPromisesModule {
  readFile: typeof readFile;
}

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));
vi.mock('node:fs/promises', async (): Promise<object> => {
  const original: FileSystemPromisesModule = await vi.importActual('node:fs/promises');
  return { ...original, readFile: vi.fn(original.readFile) };
});

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('Kubernetes install kubeconfig resolution', (): void => {
  it('skips an empty home kubeconfig and selects the readable k3s kubeconfig', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const homeDirectory: string = join(root, 'home');
    const k3sPath: string = join(root, 'k3s.yaml');
    await mkdir(join(homeDirectory, '.kube'), { recursive: true });
    await writeFile(join(homeDirectory, '.kube', 'config'), 'clusters: null\ncurrent-context: ""\n');
    await writeFile(k3sPath, usableKubeconfig('https://127.0.0.1:6443'));

    await expect(resolveKubernetesInstallKubeconfig({ env: {}, homeDirectory, k3sPath })).resolves.toMatchObject({
      clusterServer: 'https://127.0.0.1:6443',
      label: 'k3s',
      path: k3sPath,
    });
  });

  it('reports every candidate and actionable next steps when none is usable', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const homeDirectory: string = join(root, 'home');
    const k3sPath: string = join(root, 'missing-k3s.yaml');
    await mkdir(join(homeDirectory, '.kube'), { recursive: true });
    await writeFile(join(homeDirectory, '.kube', 'config'), 'clusters: null\ncurrent-context: ""\n');

    await expect(resolveKubernetesInstallKubeconfig({ env: {}, homeDirectory, k3sPath })).rejects.toThrow(
      /No usable kubeconfig found.*\$KUBECONFIG.*~\/\.kube\/config \(no current context\).*missing-k3s\.yaml \(not found\).*point KUBECONFIG.*--disable traefik/su,
    );
  });

  it('prefers a usable KUBECONFIG path', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const configuredPath: string = join(root, 'configured.yaml');
    await writeFile(configuredPath, usableKubeconfig('https://cluster.example.test:6443'));

    await expect(
      resolveKubernetesInstallKubeconfig({ env: { KUBECONFIG: configuredPath }, homeDirectory: root }),
    ).resolves.toMatchObject({ clusterServer: 'https://cluster.example.test:6443', path: configuredPath });
  });

  it('reports the server for an explicit kube context', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const configuredPath: string = join(root, 'configured.yaml');
    await writeFile(configuredPath, multiContextKubeconfig());

    await expect(
      resolveKubernetesInstallKubeconfig({
        contextName: 'other',
        env: { KUBECONFIG: configuredPath },
        homeDirectory: root,
      }),
    ).resolves.toMatchObject({ clusterServer: 'https://other.example.test:6443', contextName: 'other' });
  });

  it('does not fall back when an explicit KUBECONFIG path is missing', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const homeDirectory: string = join(root, 'home');
    await mkdir(join(homeDirectory, '.kube'), { recursive: true });
    await writeFile(join(homeDirectory, '.kube', 'config'), usableKubeconfig('https://wrong.example.test:6443'));
    const missingPath: string = join(root, 'missing.yaml');

    await expect(
      resolveKubernetesInstallKubeconfig({ env: { KUBECONFIG: missingPath }, homeDirectory }),
    ).rejects.toThrow(new RegExp(`\\$KUBECONFIG.*${missingPath}.*not found.*no fallback`, 'su'));
  });

  it('reports every invalid path from an explicit multi-file KUBECONFIG', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const firstPath: string = join(root, 'first-missing.yaml');
    const secondPath: string = join(root, 'second-missing.yaml');

    await expect(
      resolveKubernetesInstallKubeconfig({
        env: { KUBECONFIG: `${firstPath}${delimiter}${secondPath}` },
        homeDirectory: root,
      }),
    ).rejects.toThrow(new RegExp(`${firstPath}.*not found.*${secondPath}.*not found`, 'su'));
  });

  it('materializes a usable merged kubeconfig from split KUBECONFIG files', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const clusterPath: string = join(root, 'cluster.yaml');
    const contextPath: string = join(root, 'context.yaml');
    await writeFile(
      clusterPath,
      'clusters:\n  - name: split\n    cluster:\n      server: https://split.example.test:6443\nusers:\n  - name: operator\n    user:\n      token: secret\n',
    );
    await writeFile(
      contextPath,
      'contexts:\n  - name: split\n    context:\n      cluster: split\n      user: operator\ncurrent-context: split\n',
    );

    const resolved: ResolvedKubernetesKubeconfig = await resolveKubernetesInstallKubeconfig({
      env: { KUBECONFIG: `${clusterPath}${delimiter}${contextPath}` },
      homeDirectory: root,
    });
    const merged: string = await readFile(resolved.path, 'utf8');

    expect(resolved).toMatchObject({ clusterServer: 'https://split.example.test:6443', contextName: 'split' });
    expect(merged).toContain('"clusters"');
    expect(merged).toContain('"contexts"');
    expect(merged).toContain('"users"');
    if (resolved.materializedDirectory !== undefined) {
      await rm(resolved.materializedDirectory, { force: true, recursive: true });
    }
  });

  it('resolves an explicit context without requiring current-context', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const configuredPath: string = join(root, 'configured.yaml');
    await writeFile(
      configuredPath,
      'clusters:\n  - name: target\n    cluster:\n      server: https://target.example.test:6443\ncontexts:\n  - name: target\n    context:\n      cluster: target\n',
    );

    await expect(
      resolveKubernetesInstallKubeconfig({
        contextName: 'target',
        env: { KUBECONFIG: configuredPath },
        homeDirectory: root,
      }),
    ).resolves.toMatchObject({ clusterServer: 'https://target.example.test:6443', contextName: 'target' });
  });

  it('reports a missing requested context separately', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const configuredPath: string = join(root, 'configured.yaml');
    await writeFile(configuredPath, usableKubeconfig('https://cluster.example.test:6443'));

    await expect(
      resolveKubernetesInstallKubeconfig({
        contextName: 'missing',
        env: { KUBECONFIG: configuredPath },
        homeDirectory: root,
      }),
    ).rejects.toThrow('context "missing" not found');
  });

  it('does not call an existing but unusable requested context missing', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const configuredPath: string = join(root, 'configured.yaml');
    await writeFile(configuredPath, 'contexts:\n  - name: target\n    context:\n      cluster: absent\nclusters: []\n');

    await expect(
      resolveKubernetesInstallKubeconfig({
        contextName: 'target',
        env: { KUBECONFIG: configuredPath },
        homeDirectory: root,
      }),
    ).rejects.toThrow('No usable kubeconfig found.');
  });

  it('reports an unreadable k3s kubeconfig without installation advice', async (): Promise<void> => {
    const root: string = await mkdtemp(join(tmpdir(), 'compartment-kubeconfig-'));
    const k3sPath: string = join(root, 'k3s.yaml');
    const mockedReadFile: MockedFunction<typeof readFile> = vi
      .mocked(readFile)
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }))
      .mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    const resolution: Promise<ResolvedKubernetesKubeconfig> = resolveKubernetesInstallKubeconfig({
      env: {},
      homeDirectory: root,
      k3sPath,
    });
    const failure: Error = await resolution.then(
      (): Error => new Error('Expected kubeconfig resolution to fail.'),
      (error: Error): Error => error,
    );
    expect(failure.message).toMatch(/exists but not readable.*run with sudo or export KUBECONFIG/su);
    expect(failure.message).not.toContain('install one first');
    expect(mockedReadFile).toHaveBeenCalledWith(k3sPath, 'utf8');
  });
});

describe('Kubernetes install cluster preflight', (): void => {
  it('propagates the selected kubeconfig to Helm and later kubectl commands', (): void => {
    const target: Pick<
      KubernetesInstallDeploymentInput,
      'kubeconfigPath' | 'kubeContext' | 'namespace' | 'releaseName'
    > = {
      kubeconfigPath: '/tmp/k3s.yaml',
      kubeContext: 'default',
      namespace: 'compartment',
      releaseName: 'compartment',
    };

    expect(buildHelmCommand(target, ['status'])).toEqual([
      'helm',
      'status',
      '--kubeconfig',
      '/tmp/k3s.yaml',
      '--kube-context',
      'default',
    ]);
    expect(buildKubectlCommand(target, ['get', 'service'])).toContain('/tmp/k3s.yaml');
  });

  it('passes when Traefik occupies host ports 80 and 443 because host ports are not preflight concerns', async (): Promise<void> => {
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

    await expect(runKubernetesInstallPreflight(preflightInput())).resolves.toEqual({ storageClass: '' });
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
    const commands: string = mockedRunCommand.mock.calls
      .map((call: [command: readonly string[], env?: NodeJS.ProcessEnv | undefined]): string => call[0].join(' '))
      .join('\n');
    expect(commands).not.toContain('services');
    expect(commands).not.toContain('daemonsets');
    expect(commands).not.toContain('80');
    expect(commands).not.toContain('443');
  });

  it('passes the selected kubeconfig to every kubectl check and detects local-path', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[{"metadata":{"name":"local-path"}}]}' });

    await expect(runKubernetesInstallPreflight(preflightInput())).resolves.toEqual({ storageClass: 'local-path' });
    for (const command of mockedRunCommand.mock.calls) {
      expect(command[0]).toContain('--kubeconfig');
      expect(command[0]).toContain('/tmp/k3s.yaml');
    }
  });

  it('skips storage-class discovery for the advanced values path', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' });

    await expect(runKubernetesInstallPreflight({ ...preflightInput(), detectStorageClass: false })).resolves.toEqual({
      storageClass: '',
    });
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('reports a missing kubectl executable separately', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 127, stderr: 'spawn kubectl ENOENT', stdout: '' });

    await expect(runKubernetesInstallPreflight(preflightInput())).rejects.toThrow(
      'kubectl is not installed or not on PATH',
    );
  });
});

function preflightInput(): KubernetesInstallPreflightInput {
  const resolvedKubeconfig: ResolvedKubernetesKubeconfig = {
    clusterServer: 'https://127.0.0.1:6443',
    contextName: 'default',
    label: 'k3s',
    path: '/tmp/k3s.yaml',
  };
  return { detectStorageClass: true, resolvedKubeconfig };
}

function usableKubeconfig(server: string): string {
  return `clusters:\n  - name: default\n    cluster:\n      server: ${server}\ncontexts:\n  - name: default\n    context:\n      cluster: default\ncurrent-context: default\n`;
}

function multiContextKubeconfig(): string {
  return `clusters:\n  - name: default\n    cluster:\n      server: https://current.example.test:6443\n  - name: other\n    cluster:\n      server: https://other.example.test:6443\ncontexts:\n  - name: default\n    context:\n      cluster: default\n  - name: other\n    context:\n      cluster: other\ncurrent-context: default\n`;
}

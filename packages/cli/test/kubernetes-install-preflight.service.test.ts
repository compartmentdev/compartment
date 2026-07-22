import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand } from '../src/command-runner';
import { buildHelmKubeContextArgs, buildKubectlCommand } from '../src/services/kubernetes-command.support';
import {
  resolveKubernetesInstallKubeconfig,
  runKubernetesInstallPreflight,
} from '../src/services/kubernetes-install-preflight.service';
import type { KubernetesPublicIngressResolutionInput } from '../src/services/kubernetes-install.service.types';
import type {
  KubernetesInstallPreflightInput,
  ResolvedKubernetesKubeconfig,
} from '../src/services/kubernetes-install-preflight.service.types';

vi.mock('../src/command-runner', (): object => ({ runCommand: vi.fn() }));

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
});

describe('Kubernetes install cluster preflight', (): void => {
  it('propagates the selected kubeconfig to Helm and later kubectl commands', (): void => {
    const target: KubernetesPublicIngressResolutionInput = {
      kubeconfigPath: '/tmp/k3s.yaml',
      kubeContext: 'default',
      namespace: 'compartment',
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      releaseName: 'compartment',
    };

    expect(buildHelmKubeContextArgs(target)).toEqual(['--kubeconfig', '/tmp/k3s.yaml', '--kube-context', 'default']);
    expect(buildKubectlCommand(target, ['get', 'service'])).toContain('/tmp/k3s.yaml');
  });

  it('fails fast when a foreign LoadBalancer exposes either ingress port', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' }).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        items: [
          {
            metadata: { name: 'traefik', namespace: 'kube-system' },
            spec: { ports: [{ port: 80 }], type: 'LoadBalancer' },
          },
        ],
      }),
    });

    await expect(runKubernetesInstallPreflight(preflightInput())).rejects.toThrow(
      "Ports 80/443 are already taken by Service kube-system/traefik — the platform's Caddy LoadBalancer will never get an address.",
    );
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it('ignores ClusterIP services and the target release Caddy service', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          items: [
            { metadata: { name: 'web', namespace: 'default' }, spec: { ports: [{ port: 80 }], type: 'ClusterIP' } },
            {
              metadata: {
                labels: {
                  'app.kubernetes.io/component': 'caddy',
                  'app.kubernetes.io/instance': 'compartment',
                },
                name: 'compartment-caddy',
                namespace: 'compartment',
              },
              spec: { ports: [{ port: 443 }], type: 'LoadBalancer' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' });

    await expect(runKubernetesInstallPreflight(preflightInput())).resolves.toEqual({ storageClass: '' });
  });

  it('treats matching release labels in another namespace as a conflict', async (): Promise<void> => {
    mockedRunCommand.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' }).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        items: [
          {
            metadata: {
              labels: {
                'app.kubernetes.io/component': 'caddy',
                'app.kubernetes.io/instance': 'compartment',
              },
              name: 'compartment-caddy',
              namespace: 'other',
            },
            spec: { ports: [{ port: 443 }], type: 'LoadBalancer' },
          },
        ],
      }),
    });

    await expect(runKubernetesInstallPreflight(preflightInput())).rejects.toThrow('Service other/compartment-caddy');
  });

  it('passes the selected kubeconfig to every kubectl check and detects local-path', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[{"metadata":{"name":"local-path"}}]}' });

    await expect(runKubernetesInstallPreflight(preflightInput())).resolves.toEqual({ storageClass: 'local-path' });
    for (const command of mockedRunCommand.mock.calls) {
      expect(command[0]).toContain('--kubeconfig');
      expect(command[0]).toContain('/tmp/k3s.yaml');
    }
  });

  it('skips storage-class discovery for the advanced values path', async (): Promise<void> => {
    mockedRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{}' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[]}' });

    await expect(runKubernetesInstallPreflight({ ...preflightInput(), detectStorageClass: false })).resolves.toEqual({
      storageClass: '',
    });
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });
});

function preflightInput(): KubernetesInstallPreflightInput {
  const resolvedKubeconfig: ResolvedKubernetesKubeconfig = {
    clusterServer: 'https://127.0.0.1:6443',
    contextName: 'default',
    label: 'k3s',
    path: '/tmp/k3s.yaml',
  };
  return { detectStorageClass: true, namespace: 'compartment', releaseName: 'compartment', resolvedKubeconfig };
}

function usableKubeconfig(server: string): string {
  return `clusters:\n  - name: default\n    cluster:\n      server: ${server}\ncontexts:\n  - name: default\n    context:\n      cluster: default\ncurrent-context: default\n`;
}

function multiContextKubeconfig(): string {
  return `clusters:\n  - name: default\n    cluster:\n      server: https://current.example.test:6443\n  - name: other\n    cluster:\n      server: https://other.example.test:6443\ncontexts:\n  - name: default\n    context:\n      cluster: default\n  - name: other\n    context:\n      cluster: other\ncurrent-context: default\n`;
}

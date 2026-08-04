import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runCli } from '../src/app';
import type { ResolvedInstallIdentityPrompts } from '../src/commands/install/install.command.types';
import type { CliInstallResult } from '../src/install.types';
import { KubernetesInstallKubeconfigResolutionError } from '../src/services/kubernetes-install-kubeconfig.error';
import type { KubernetesInstallDeploymentResult } from '../src/services/kubernetes-install.service.types';
import type { ResolvedKubernetesKubeconfig } from '../src/services/kubernetes-install-kubeconfig.service.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

type DeployInstall = () => Promise<KubernetesInstallDeploymentResult>;
type InstallOwner = () => Promise<CliInstallResult>;
type PersistSession = () => Promise<void>;
type ResolveIdentity = () => Promise<ResolvedInstallIdentityPrompts>;
type AssertLocalTools = () => Promise<void>;
type ResolveKubeconfig = () => Promise<ResolvedKubernetesKubeconfig>;

interface InstallCommandMocks {
  assertLocalTools: Mock<AssertLocalTools>;
  deployInstall: Mock<DeployInstall>;
  installOwner: Mock<InstallOwner>;
  persistSession: Mock<PersistSession>;
  resolveIdentity: Mock<ResolveIdentity>;
  resolveKubeconfig: Mock<ResolveKubeconfig>;
}

const mocks: InstallCommandMocks = vi.hoisted(
  (): InstallCommandMocks => ({
    assertLocalTools: vi.fn<AssertLocalTools>(),
    deployInstall: vi.fn<DeployInstall>(),
    installOwner: vi.fn<InstallOwner>(),
    persistSession: vi.fn<PersistSession>(),
    resolveIdentity: vi.fn<ResolveIdentity>(),
    resolveKubeconfig: vi.fn<ResolveKubeconfig>(),
  }),
);

vi.mock('../src/services/kubernetes-install-local-tools.service', (): object => ({
  assertKubernetesInstallLocalTools: mocks.assertLocalTools,
}));
vi.mock('../src/services/kubernetes-install-kubeconfig.service', (): object => ({
  resolveKubernetesInstallKubeconfig: mocks.resolveKubeconfig,
}));
vi.mock('../src/install', (): object => ({
  installDev: vi.fn(),
  installKubernetesOwner: mocks.installOwner,
}));
vi.mock('../src/services/kubernetes-install.service', (): object => ({
  deployAndWaitForKubernetesInstall: mocks.deployInstall,
}));
vi.mock('../src/commands/install/install.command.identity', (): object => ({
  buildOwnerInstallInput: (prompts: ResolvedInstallIdentityPrompts): object => ({
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
  }),
  readConfiguredInstallAdminPassword: (): undefined => undefined,
  readBoundaryInstallAdminPassword: async (): Promise<undefined> => await Promise.resolve(undefined),
  resolveInstallIdentityPrompts: mocks.resolveIdentity,
}));
vi.mock('../src/commands/install/install.command.session', (): object => ({
  persistDevInstallSession: vi.fn(),
  persistInstallSession: mocks.persistSession,
}));

describe('install command boundary', (): void => {
  beforeEach((): void => {
    mocks.assertLocalTools.mockReset().mockResolvedValue(undefined);
    mocks.deployInstall.mockReset().mockResolvedValue(createDeploymentResult());
    mocks.installOwner.mockReset().mockResolvedValue(createInstallResult());
    mocks.persistSession.mockReset().mockResolvedValue(undefined);
    mocks.resolveIdentity.mockReset().mockResolvedValue({
      adminEmail: 'admin@example.com',
      adminPassword: 'correct horse battery staple',
      organizationName: 'Acme Dev',
    });
    mocks.resolveKubeconfig.mockReset().mockResolvedValue({
      clusterServer: 'https://127.0.0.1:6443',
      contextName: 'default',
      label: 'k3s',
      path: '/etc/rancher/k3s/k3s.yaml',
    });
  });

  it('reports exact cluster guidance before checking local tools on an empty machine', async (): Promise<void> => {
    mocks.resolveKubeconfig.mockRejectedValueOnce(
      new KubernetesInstallKubeconfigResolutionError('No usable kubeconfig found.', 'no-usable-cluster'),
    );
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install', '--target', 'kubernetes'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toBe(
      '✗ kubeconfig: No usable Kubernetes cluster found.\n\nCompartment installs into an existing Kubernetes cluster.\n\nInstall a supported cluster or set KUBECONFIG to an existing one.\n\nAlso required: kubectl >= 1.30 and Helm >= 4.\n',
    );
    expect(mocks.assertLocalTools).not.toHaveBeenCalled();
  });

  it('keeps empty-machine guidance with an explicit context when no cluster exists', async (): Promise<void> => {
    mocks.resolveKubeconfig.mockRejectedValueOnce(
      new KubernetesInstallKubeconfigResolutionError('No usable kubeconfig found.', 'no-usable-cluster'),
    );
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(
      ['install', '--target', 'kubernetes', '--kube-context', 'production'],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('No usable Kubernetes cluster found.');
    expect(readCliStderr(capture)).not.toContain('context "production" not found');
  });

  it('discovers the K3s kubeconfig before reporting missing Helm', async (): Promise<void> => {
    mocks.assertLocalTools.mockRejectedValueOnce(new Error('helm not found on PATH. Install Helm >= 4.0.0.'));
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install', '--target', 'kubernetes'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('✓ kubeconfig: /etc/rancher/k3s/k3s.yaml (k3s)');
    expect(readCliStderr(capture)).toContain('helm not found on PATH');
  });

  it('removes a materialized merged kubeconfig when local tool validation fails', async (): Promise<void> => {
    const materializedDirectory: string = await mkdtemp(resolve(tmpdir(), 'compartment-command-kubeconfig-'));
    mocks.resolveKubeconfig.mockResolvedValueOnce({
      clusterServer: 'https://cluster.example.test:6443',
      contextName: 'production',
      materializedDirectory,
      path: resolve(materializedDirectory, 'kubeconfig.json'),
    });
    mocks.assertLocalTools.mockRejectedValueOnce(new Error('kubectl not found on PATH.'));
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    expect(await runCli(['install', '--target', 'kubernetes'], capture.io)).toBe(1);
    await expect(stat(materializedDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a missing local tool before an interactive prompt starts', async (): Promise<void> => {
    mocks.assertLocalTools.mockRejectedValueOnce(
      new Error(
        'helm not found on PATH. Install Helm >= 4.0.0 with `curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash`, then re-run install.',
      ),
    );
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install', '--target', 'kubernetes'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('helm not found on PATH');
    expect(readCliStderr(capture)).not.toContain('Kubernetes context');
    expect(readCliStderr(capture)).not.toContain('Domain');
    expect(capture.stdout).toEqual([]);
    expect(mocks.assertLocalTools).toHaveBeenCalledTimes(1);
  });

  it('validates non-interactive input before discovering the cluster or checking tools', async (): Promise<void> => {
    mocks.assertLocalTools.mockRejectedValueOnce(
      new Error('helm not found on PATH. Install Helm >= 4.0.0 and re-run install.'),
    );
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--target', 'kubernetes', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('Missing required install input');
    expect(readCliStderr(capture)).not.toContain('helm not found on PATH');
    expect(mocks.resolveKubeconfig).not.toHaveBeenCalled();
    expect(mocks.assertLocalTools).not.toHaveBeenCalled();
  });

  it('reports the first missing canonical input at the non-interactive CLI boundary', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--target', 'kubernetes', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('Missing required install input: --managed-domain or --base-domain.');
    expect(mocks.assertLocalTools).not.toHaveBeenCalled();
  });

  it('accepts a managed domain without onboarding authorization', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(
      ['install', '--target', 'kubernetes', '--managed-domain', '--output', 'json'],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('Missing required install input: --email.');
    expect(readCliStderr(capture)).not.toContain('--init-install');
    expect(mocks.deployInstall).not.toHaveBeenCalled();
  });

  it('reports conflicting domain flags at the domain boundary', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(
      ['install', '--target', 'kubernetes', '--managed-domain', '--base-domain', 'apps.example.com'],
      capture.io,
    );

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--managed-domain cannot be combined with --base-domain.');
    expect(readCliStderr(capture)).not.toContain('public installer');
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

  it('rejects canonical cluster selection flags on the dev install path', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--ingress-class', 'nginx'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--dev cannot be combined with --ingress-class.');
  });

  it('rejects the removed node-registry option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const removedOption: string = ['--skip', 'registry', 'mirror'].join('-');
    const exitCode: number = await runCli(['install', '--dev', removedOption], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain(`unknown option '${removedOption}'`);
  });

  it('rejects the removed local Docker runtime option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--local-runtime'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain("unknown option '--local-runtime'");
  });

  it('keeps the operator-values path on the Kubernetes install boundary', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--values', 'compartment-values.yaml'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--dev cannot be combined with --values.');
  });

  it('renders all incomplete operator values issues without Zod internals at the CLI boundary', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-command-values-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(valuesPath, 'tls:\n  existingSecret: platform-tls\n');
      const capture: CliCommandCapture = createCliCapture();

      const exitCode: number = await runCli(
        [
          'install',
          '--target',
          'kubernetes',
          '--base-domain',
          'apps.example.com',
          '--email',
          'owner@example.com',
          '--organization',
          'Acme',
          '--admin-password',
          'correct horse battery staple',
          '--kube-context',
          'production',
          '--values',
          valuesPath,
        ],
        capture.io,
      );

      const stderr: string = readCliStderr(capture);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`${valuesPath}: ingress: is required and must define className`);
      expect(stderr).toContain(`${valuesPath}: registry.issuerRef: is required because the private registry`);
      expect(stderr).not.toMatch(/ZodError|"code"|"expected"|"received"|at parse/u);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createDeploymentResult(): KubernetesInstallDeploymentResult {
  return {
    apiUrl: 'https://console.apps.example.com',
    baseDomain: 'apps.example.com',
    installToken: 'install-token',
  };
}

function createInstallResult(): CliInstallResult {
  return {
    adminEmail: 'admin@example.com',
    apiUrl: 'https://console.apps.example.com',
    baseDomain: 'apps.example.com',
    compartmentUrl: 'https://console.apps.example.com',
    dnsRecords: [],
    operation: {
      completedAt: '2026-07-22T10:00:05.000Z',
      createdAt: '2026-07-22T10:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'org_123',
      targetType: 'organization',
      type: 'compartment.install',
    },
    organization: { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
    sessionToken: 'session_123',
  };
}

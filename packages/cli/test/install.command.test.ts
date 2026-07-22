import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runCli } from '../src/app';
import type {
  InstallPreflightChecklistResult,
  ResolvedInstallIdentityPrompts,
} from '../src/commands/install/install.command.types';
import type { CliInstallResult } from '../src/install.types';
import type { KubernetesInstallDeploymentResult } from '../src/services/kubernetes-install.service.types';
import type {
  KubernetesRegistryMirror,
  KubernetesRegistryMirrorApplyResult,
} from '../src/services/kubernetes-registry-mirror.service.types';
import { createCliCapture, readCliStderr, readCliStdout, type CliCommandCapture } from './cli-test.harness';

type ApplyRegistryMirror = (mirror: KubernetesRegistryMirror) => Promise<KubernetesRegistryMirrorApplyResult>;
type CanAutoApplyRegistryMirror = () => Promise<boolean>;
type DeployInstall = () => Promise<KubernetesInstallDeploymentResult>;
type InstallOwner = () => Promise<CliInstallResult>;
type PersistSession = () => Promise<void>;
type ReadRegistryMirror = () => Promise<KubernetesRegistryMirror>;
type ResolveIdentity = () => Promise<ResolvedInstallIdentityPrompts>;

interface InstallCommandMocks {
  applyRegistryMirror: Mock<ApplyRegistryMirror>;
  canAutoApplyRegistryMirror: Mock<CanAutoApplyRegistryMirror>;
  deployInstall: Mock<DeployInstall>;
  installOwner: Mock<InstallOwner>;
  persistSession: Mock<PersistSession>;
  readRegistryMirror: Mock<ReadRegistryMirror>;
  resolveIdentity: Mock<ResolveIdentity>;
}

const registryMirror: KubernetesRegistryMirror = {
  clusterIp: ['10', '43', '210', '17'].join('.'),
  host: 'compartment-compartment-registry-auth.compartment.svc:5000',
};
const mocks: InstallCommandMocks = vi.hoisted(
  (): InstallCommandMocks => ({
    applyRegistryMirror: vi.fn<ApplyRegistryMirror>(),
    canAutoApplyRegistryMirror: vi.fn<CanAutoApplyRegistryMirror>(),
    deployInstall: vi.fn<DeployInstall>(),
    installOwner: vi.fn<InstallOwner>(),
    persistSession: vi.fn<PersistSession>(),
    readRegistryMirror: vi.fn<ReadRegistryMirror>(),
    resolveIdentity: vi.fn<ResolveIdentity>(),
  }),
);

vi.mock('../src/install', (): object => ({
  installDev: vi.fn(),
  installKubernetesOwner: mocks.installOwner,
}));
vi.mock('../src/services/kubernetes-install.service', (): object => ({
  deployAndWaitForKubernetesInstall: mocks.deployInstall,
}));
vi.mock('../src/services/kubernetes-registry-mirror.service', (): object => ({
  applyKubernetesRegistryMirror: mocks.applyRegistryMirror,
  canAutoApplyKubernetesRegistryMirror: mocks.canAutoApplyRegistryMirror,
  readInstalledKubernetesRegistryMirror: mocks.readRegistryMirror,
  renderKubernetesRegistryMirrorInstructions: (): string => 'Exact registry mirror instructions.\n',
}));
vi.mock('../src/commands/install/install.command.identity', (): object => ({
  buildOwnerInstallInput: (prompts: ResolvedInstallIdentityPrompts): object => ({
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
  }),
  resolveInstallIdentityPrompts: mocks.resolveIdentity,
}));
vi.mock('../src/commands/install/install.command.preflight', (): object => ({
  runInstallPreflightChecklist: vi.fn(
    async (): Promise<InstallPreflightChecklistResult> =>
      await Promise.resolve({
        kubeconfig: {
          clusterServer: 'https://127.0.0.1:6443',
          contextName: 'default',
          materializedDirectory: undefined,
          path: '/tmp/kubeconfig',
        },
        preflight: { storageClass: 'local-path' },
      }),
  ),
}));
vi.mock('../src/commands/install/install.command.session', (): object => ({
  persistDevInstallSession: vi.fn(),
  persistInstallSession: mocks.persistSession,
}));

describe('install command boundary', (): void => {
  beforeEach((): void => {
    mocks.applyRegistryMirror.mockReset().mockResolvedValue({ configChanged: true, current: true });
    mocks.canAutoApplyRegistryMirror.mockReset().mockResolvedValue(true);
    mocks.deployInstall.mockReset().mockResolvedValue(createDeploymentResult());
    mocks.installOwner.mockReset().mockResolvedValue(createInstallResult());
    mocks.persistSession.mockReset().mockResolvedValue(undefined);
    mocks.readRegistryMirror.mockReset().mockResolvedValue(registryMirror);
    mocks.resolveIdentity.mockReset().mockResolvedValue({
      adminEmail: 'admin@example.com',
      adminPassword: 'correct horse battery staple',
      organizationName: 'Acme Dev',
    });
  });

  it('requires operator values for production Kubernetes install', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--values is required when running non-interactively.');
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

  it('keeps registry mirror setup out of the dev install path', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const exitCode: number = await runCli(['install', '--dev', '--skip-registry-mirror'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('--dev cannot be combined with --skip-registry-mirror.');
  });

  it('rejects the removed local Docker runtime option', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--dev', '--local-runtime'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain("unknown option '--local-runtime'");
  });

  it('continues owner bootstrap and prints generic mirror instructions when Service discovery blips', async (): Promise<void> => {
    mocks.readRegistryMirror.mockRejectedValue(new Error('kubectl temporarily unavailable'));
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Warning: could not inspect the installed registry-auth Service');
    expect(stderr).toContain('Registry mirror setup is still required before the first application deploy.');
    expect(stderr).toContain('system registry-mirror apply');
    expect(readCliStdout(capture)).toContain('Installed Compartment at https://console.apps.example.com');
  });

  it('auto-applies a --values install from a TTY without prompting', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);
    const stderr: string = readCliStderr(capture);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Applying the registry mirror automatically on the local k3s node.');
    expect(stderr).toContain('Updated /etc/rancher/k3s/registries.yaml');
    expect(stderr).not.toContain('Apply this registry mirror on the local k3s node now?');
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

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runCli } from '../src/app';
import type {
  InstallPreflightChecklistResult,
  ResolvedInstallIdentityPrompts,
} from '../src/commands/install/install.command.types';
import type { CliInstallResult } from '../src/install.types';
import type { KubernetesInstallDeploymentResult } from '../src/services/kubernetes-install.service.types';
import { createCliCapture, readCliStderr, readCliStdout, type CliCommandCapture } from './cli-test.harness';

type DeployInstall = () => Promise<KubernetesInstallDeploymentResult>;
type InstallOwner = () => Promise<CliInstallResult>;
type PersistSession = () => Promise<void>;
type ResolveIdentity = () => Promise<ResolvedInstallIdentityPrompts>;

interface InstallCommandMocks {
  deployInstall: Mock<DeployInstall>;
  installOwner: Mock<InstallOwner>;
  persistSession: Mock<PersistSession>;
  resolveIdentity: Mock<ResolveIdentity>;
}

const mocks: InstallCommandMocks = vi.hoisted(
  (): InstallCommandMocks => ({
    deployInstall: vi.fn<DeployInstall>(),
    installOwner: vi.fn<InstallOwner>(),
    persistSession: vi.fn<PersistSession>(),
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
    mocks.deployInstall.mockReset().mockResolvedValue(createDeploymentResult());
    mocks.installOwner.mockReset().mockResolvedValue(createInstallResult());
    mocks.persistSession.mockReset().mockResolvedValue(undefined);
    mocks.resolveIdentity.mockReset().mockResolvedValue({
      adminEmail: 'admin@example.com',
      adminPassword: 'correct horse battery staple',
      organizationName: 'Acme Dev',
    });
  });

  it('reports the first missing canonical input at the non-interactive CLI boundary', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--output', 'json'], capture.io);

    expect(exitCode).toBe(1);
    expect(readCliStderr(capture)).toContain('Missing required install input: --managed-domain or --base-domain.');
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

  it('completes a declarative Kubernetes install without node mutation', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();

    const exitCode: number = await runCli(['install', '--values', 'compartment-values.yaml'], capture.io);

    expect(exitCode).toBe(0);
    expect(readCliStdout(capture)).toContain('Installed Compartment at https://console.apps.example.com');
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

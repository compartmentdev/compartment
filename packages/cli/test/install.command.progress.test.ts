import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { InstallPreflightChecklistResult } from '../src/commands/install/install.command.types';
import type { CliInstallResult } from '../src/install.types';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
} from '../src/services/kubernetes-install.service.types';
import { createCliCapture, readCliStderr, readCliStdout, type CliCommandCapture } from './cli-test.harness';

interface InstallCommandMocks {
  deploy: Mock<(input: KubernetesInstallDeploymentInput) => Promise<KubernetesInstallDeploymentResult>>;
  installOwner: Mock<() => Promise<CliInstallResult>>;
}

const mocks: InstallCommandMocks = vi.hoisted((): InstallCommandMocks => ({ deploy: vi.fn(), installOwner: vi.fn() }));
const installResult: CliInstallResult = {
  adminEmail: 'admin@example.com',
  apiUrl: 'https://console.apps.example.com',
  baseDomain: 'apps.example.com',
  compartmentUrl: 'https://console.apps.example.com',
  dnsRecords: [{ host: 'console.apps.example.com', purpose: 'Console', type: 'A/AAAA-or-CNAME' }],
  operation: {
    completedAt: '2026-07-22T09:00:01.000Z',
    createdAt: '2026-07-22T09:00:00.000Z',
    id: 'op_123',
    status: 'succeeded',
    targetId: 'org_123',
    targetType: 'organization',
    type: 'compartment.install',
  },
  organization: { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
  sessionToken: 'session_123',
};

vi.mock('../src/services/kubernetes-install.service', (): object => ({
  deployAndWaitForKubernetesInstall: mocks.deploy,
}));
vi.mock('../src/commands/install/install.command.preflight', (): object => ({
  runInstallPreflightChecklist: vi.fn(
    async (): Promise<InstallPreflightChecklistResult> =>
      await Promise.resolve({
        kubeconfig: {
          clusterServer: 'https://127.0.0.1:6443',
          contextName: 'default',
          path: '/tmp/kubeconfig',
        },
        preflight: { storageClass: 'local-path' },
      }),
  ),
}));
vi.mock('../src/install', (): object => ({ installDev: vi.fn(), installKubernetesOwner: mocks.installOwner }));
vi.mock('../src/prompts/prompt', (): object => ({
  promptNewPassword: vi.fn(async (): Promise<string> => await Promise.resolve('supersecretpassword')),
  promptRegisterEmail: vi.fn(async (): Promise<string> => await Promise.resolve('admin@example.com')),
  promptRegisterOrganization: vi.fn(async (): Promise<string> => await Promise.resolve('Acme Dev')),
}));
vi.mock('../src/commands/install/install.command.session', (): object => ({
  persistDevInstallSession: vi.fn(),
  persistInstallSession: vi.fn(),
}));

describe('install command progress', (): void => {
  beforeEach((): void => {
    mocks.deploy
      .mockReset()
      .mockImplementation(
        async (input: KubernetesInstallDeploymentInput): Promise<KubernetesInstallDeploymentResult> => {
          input.progress?.report('Issuing TLS certificate (ACME)\u2026 \u2713 1s');
          return await Promise.resolve({
            apiUrl: 'https://console.apps.example.com',
            baseDomain: 'apps.example.com',
            installToken: 'install-token',
          });
        },
      );
    mocks.installOwner.mockReset().mockResolvedValue(installResult);
  });

  it('emits owner creation after deployment in non-TTY text output', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const { runCli } = await import('../src/app');

    const exitCode: number = await runCli(buildInstallArguments('text'), capture.io);

    expect(exitCode).toBe(0);
    expect(readCliStderr(capture)).toMatch(
      /^Issuing TLS certificate \(ACME\)\u2026 \u2713 1s\nCreating owner\u2026\nCreating owner\u2026 \u2713 \d+s\n$/u,
    );
    expect(readCliStderr(capture)).not.toContain('\u001B');
  });

  it('keeps JSON output parseable and suppresses progress events', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const { runCli } = await import('../src/app');

    const exitCode: number = await runCli(buildInstallArguments('json'), capture.io);

    expect(exitCode).toBe(0);
    expect(readCliStderr(capture)).toBe('');
    expect(JSON.parse(readCliStdout(capture))).toMatchObject({ adminEmail: 'admin@example.com' });
  });
});

function buildInstallArguments(output: 'json' | 'text'): string[] {
  return [
    'install',
    '--api-url',
    'https://console.apps.example.com',
    '--base-domain',
    'apps.example.com',
    '--values',
    'operator-values.yaml',
    '--email',
    'admin@example.com',
    '--organization',
    'Acme Dev',
    '--output',
    output,
  ];
}

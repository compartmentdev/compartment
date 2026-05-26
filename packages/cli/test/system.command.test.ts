import {
  type IssuePasswordResetResponse,
  type SystemDomainMutationResponse,
  type SystemDomainStatusResponse,
  type SystemRestartResponse,
  type SystemStatusResponse,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createCliCapture,
  type CliCommandCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  type CliCommandResult,
} from './cli-test.harness';
import type * as CommandRunnerModule from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import type * as SelfHostedSystemPrivilegesModule from '../src/self-hosted-system-privileges';
import type * as SystemDomainModule from '../src/system-domain';
import type { SetSelfHostedSystemDomainInput } from '../src/system-domain.types';
import type { SelfHostedSystemInput } from '../src/system.types';

type GetSelfHostedSystemStatus = () => Promise<SystemStatusResponse>;
type IssueSelfHostedPasswordReset = (email: string) => Promise<IssuePasswordResetResponse>;
type RestartSelfHostedSystem = (input: SelfHostedSystemInput) => Promise<SystemRestartResponse>;
type GetSelfHostedSystemDomainStatus = () => Promise<SystemDomainStatusResponse>;
type SetSelfHostedSystemDomain = (input: SetSelfHostedSystemDomainInput) => Promise<SystemDomainMutationResponse>;

describe.sequential('compartment system command boundary validation', (): void => {
  afterEach((): void => {
    restoreCliCommandModules([
      '../src/command-runner',
      '../src/system-domain',
      '../src/system-restart',
      '../src/system-password-reset',
      '../src/system-status',
    ]);
  });

  it('renders text output for system status and restart', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock('../src/system-status', (): { getSelfHostedSystemStatus: Mock<GetSelfHostedSystemStatus> } => ({
      getSelfHostedSystemStatus: vi.fn<GetSelfHostedSystemStatus>().mockResolvedValue(createSystemStatusResponse()),
    }));
    vi.doMock('../src/system-restart', (): { restartSelfHostedSystem: Mock<RestartSelfHostedSystem> } => ({
      restartSelfHostedSystem: vi.fn<RestartSelfHostedSystem>().mockResolvedValue({
        configDir: '/tmp/compartment/etc',
        dataDir: '/tmp/compartment/var',
        restartedAt: '2026-04-09T12:00:00.000Z',
        services: ['api', 'registry', 'edge', 'node', 'builder', 'worker', 'caddy', 'postgres'],
      }),
    }));

    const statusResult: CliCommandResult = await runCliCommand(['system', 'status']);
    const restartResult: CliCommandResult = await runCliCommand(['system', 'restart']);

    expectCliSuccess(statusResult);
    expectCliSuccess(restartResult);
    expect(readCliStdout(statusResult.capture)).toContain('Self-hosted platform status: degraded.');
    expect(readCliStdout(statusResult.capture)).toContain('Console: https://console.customer.example.com.');
    expect(readCliStdout(statusResult.capture)).toContain('Login your CLI on this server:');
    expect(readCliStdout(statusResult.capture)).toContain('--api-url http://127.0.0.1:39444');
    expect(readCliStdout(statusResult.capture)).toContain('Image registry: github.');
    expect(readCliStdout(statusResult.capture)).toContain('Rollback retention: indefinite.');
    expect(readCliStdout(statusResult.capture)).not.toContain('Domain:');
    expect(readCliStdout(statusResult.capture)).not.toContain('Hosted apps:');
    expect(readCliStdout(statusResult.capture)).toContain(
      'api: running, health unhealthy, uptime 3600s; image ghcr.io/compartmentdev/compartment-api:0.2.0; ports 127.0.0.1:39444->39444',
    );
    expect(readCliStdout(restartResult.capture)).toContain(
      'Restarted self-hosted platform using config /tmp/compartment/etc and data /tmp/compartment/var.',
    );
    expect(readCliStdout(restartResult.capture)).toContain(
      'Services: api, registry, edge, node, builder, worker, caddy, postgres.',
    );
  });

  it('renders restart progress for text output without polluting JSON output', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock('../src/system-restart', (): { restartSelfHostedSystem: Mock<RestartSelfHostedSystem> } => ({
      restartSelfHostedSystem: vi
        .fn<RestartSelfHostedSystem>()
        .mockImplementation(async (input: SelfHostedSystemInput): Promise<SystemRestartResponse> => {
          input.context?.reportProgress?.('Restarting self-hosted runtime...');
          await Promise.resolve();
          return {
            configDir: '/tmp/compartment/etc',
            dataDir: '/tmp/compartment/var',
            restartedAt: '2026-04-09T12:00:00.000Z',
            services: ['api', 'registry', 'edge', 'node', 'builder', 'worker', 'caddy', 'postgres'],
          };
        }),
    }));
    const jsonCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const textCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });

    const jsonResult: CliCommandResult = await runCliCommand(['system', 'restart', '--output', 'json'], jsonCapture);
    const textResult: CliCommandResult = await runCliCommand(['system', 'restart'], textCapture);

    expectCliSuccess(jsonResult);
    expect(readCliStderr(jsonCapture)).toBe('');
    expectCliSuccess(textResult);
    expect(readCliStderr(textCapture)).toBe('Restarting self-hosted runtime...\n');
  });

  it('renders JSON output for system status', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock('../src/system-status', (): { getSelfHostedSystemStatus: Mock<GetSelfHostedSystemStatus> } => ({
      getSelfHostedSystemStatus: vi.fn<GetSelfHostedSystemStatus>().mockResolvedValue(createSystemStatusResponse()),
    }));

    const result: CliCommandResult = await runCliCommand(['system', 'status', '--output', 'json']);

    expectCliSuccess(result);
    expect(JSON.parse(readCliStdout(result.capture))).toEqual(createSystemStatusResponse());
  });

  it('renders text output for issued password resets', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/system-password-reset',
      (): { issueSelfHostedPasswordReset: Mock<IssueSelfHostedPasswordReset> } => ({
        issueSelfHostedPasswordReset: vi.fn<IssueSelfHostedPasswordReset>().mockResolvedValue({
          email: 'viewer@example.com',
          expiresAt: '2026-04-29T12:00:00.000Z',
          resetToken: 'reset-token',
          resetUrl: 'https://console.example.com/reset-password?email=viewer%40example.com&token=reset-token',
        }),
      }),
    );

    const result: CliCommandResult = await runCliCommand([
      'system',
      'issue-password-reset',
      '--email',
      'viewer@example.com',
    ]);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('Issued password reset for viewer@example.com.');
    expect(readCliStdout(result.capture)).toContain('Reset URL: https://console.example.com/reset-password?');
    expect(readCliStdout(result.capture)).toContain('Expires at: 2026-04-29T12:00:00.000Z.');
  });

  it('renders JSON output for issued password resets', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/system-password-reset',
      (): { issueSelfHostedPasswordReset: Mock<IssueSelfHostedPasswordReset> } => ({
        issueSelfHostedPasswordReset: vi
          .fn<IssueSelfHostedPasswordReset>()
          .mockResolvedValue(createIssuePasswordResetResponse()),
      }),
    );

    const result: CliCommandResult = await runCliCommand([
      'system',
      'issue-password-reset',
      '--email',
      'viewer@example.com',
      '--output',
      'json',
    ]);

    expectCliSuccess(result);
    expect(JSON.parse(readCliStdout(result.capture))).toEqual(createIssuePasswordResetResponse());
  });

  it('requires an email when issuing password resets', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'issue-password-reset']);

    expectCliFailure(result, "required option '--email <email>' not specified");
  });

  it('rejects removed custom system path flags', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'status', '--config-dir', '/tmp/compartment/etc']);

    expectCliFailure(result, "unknown option '--config-dir'");
  });

  it('surfaces system status runtime errors', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock('../src/system-status', (): { getSelfHostedSystemStatus: Mock<GetSelfHostedSystemStatus> } => ({
      getSelfHostedSystemStatus: vi
        .fn<GetSelfHostedSystemStatus>()
        .mockRejectedValue(new Error('Status inspection failed.')),
    }));

    const result: CliCommandResult = await runCliCommand(['system', 'status']);

    expectCliFailure(result, 'Status inspection failed.');
  });

  it('reruns system status with sudo from an interactive shell when root is required', async (): Promise<void> => {
    resetCliCommandModules();
    const privilegesModule: typeof SelfHostedSystemPrivilegesModule =
      await import('../src/self-hosted-system-privileges');
    const runInheritedCommandMock: Mock<(command: readonly string[]) => Promise<CommandResult>> = vi
      .fn<(command: readonly string[]) => Promise<CommandResult>>()
      .mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: '',
      });
    vi.doMock('../src/command-runner', (): typeof CommandRunnerModule => ({
      canRunCommand: vi.fn<typeof CommandRunnerModule.canRunCommand>().mockResolvedValue(false),
      readCommandOutput: vi.fn<typeof CommandRunnerModule.readCommandOutput>(),
      runCappedCommand: vi.fn<typeof CommandRunnerModule.runCappedCommand>(),
      runCommand: vi.fn<typeof CommandRunnerModule.runCommand>(),
      runInheritedCommand: runInheritedCommandMock,
      runInheritedCommandWithPipedOutput: vi.fn<typeof CommandRunnerModule.runInheritedCommandWithPipedOutput>(),
    }));
    vi.doMock('../src/system-status', (): { getSelfHostedSystemStatus: Mock<GetSelfHostedSystemStatus> } => ({
      getSelfHostedSystemStatus: vi
        .fn<GetSelfHostedSystemStatus>()
        .mockRejectedValue(new privilegesModule.SelfHostedSystemPrivilegesError()),
    }));
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const result: CliCommandResult = await runCliCommand(['system', 'status'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('System self-hosted command requires root; re-running with sudo.');
    const rerunCommand: readonly string[] = runInheritedCommandMock.mock.calls[0]?.[0] ?? [];
    expect(rerunCommand[0]).toBe('sudo');
    expect(rerunCommand.slice(-2)).toEqual(['system', 'status']);
  });

  it('prints a copy-pasteable sudo command when no interactive shell is available', async (): Promise<void> => {
    resetCliCommandModules();
    const privilegesModule: typeof SelfHostedSystemPrivilegesModule =
      await import('../src/self-hosted-system-privileges');
    const runInheritedCommandMock: Mock<(command: readonly string[]) => Promise<CommandResult>> =
      vi.fn<(command: readonly string[]) => Promise<CommandResult>>();
    vi.doMock('../src/command-runner', (): typeof CommandRunnerModule => ({
      canRunCommand: vi.fn<typeof CommandRunnerModule.canRunCommand>().mockResolvedValue(false),
      readCommandOutput: vi.fn<typeof CommandRunnerModule.readCommandOutput>(),
      runCappedCommand: vi.fn<typeof CommandRunnerModule.runCappedCommand>(),
      runCommand: vi.fn<typeof CommandRunnerModule.runCommand>(),
      runInheritedCommand: runInheritedCommandMock,
      runInheritedCommandWithPipedOutput: vi.fn<typeof CommandRunnerModule.runInheritedCommandWithPipedOutput>(),
    }));
    vi.doMock('../src/system-status', (): { getSelfHostedSystemStatus: Mock<GetSelfHostedSystemStatus> } => ({
      getSelfHostedSystemStatus: vi
        .fn<GetSelfHostedSystemStatus>()
        .mockRejectedValue(new privilegesModule.SelfHostedSystemPrivilegesError()),
    }));

    const result: CliCommandResult = await runCliCommand(['system', 'status']);

    expectCliFailure(result, 'System self-hosted commands use /etc/compartment and /var/lib/compartment. Run `sudo');
    expect(readCliStderr(result.capture)).toContain('system status` from an interactive shell.');
    expect(runInheritedCommandMock).not.toHaveBeenCalled();
  });

  it('reruns system domain status with sudo from an interactive shell when root is required', async (): Promise<void> => {
    resetCliCommandModules();
    const privilegesModule: typeof SelfHostedSystemPrivilegesModule =
      await import('../src/self-hosted-system-privileges');
    const runInheritedCommandMock: Mock<(command: readonly string[]) => Promise<CommandResult>> = vi
      .fn<(command: readonly string[]) => Promise<CommandResult>>()
      .mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: '',
      });
    vi.doMock('../src/command-runner', (): typeof CommandRunnerModule => ({
      canRunCommand: vi.fn<typeof CommandRunnerModule.canRunCommand>().mockResolvedValue(false),
      readCommandOutput: vi.fn<typeof CommandRunnerModule.readCommandOutput>(),
      runCappedCommand: vi.fn<typeof CommandRunnerModule.runCappedCommand>(),
      runCommand: vi.fn<typeof CommandRunnerModule.runCommand>(),
      runInheritedCommand: runInheritedCommandMock,
      runInheritedCommandWithPipedOutput: vi.fn<typeof CommandRunnerModule.runInheritedCommandWithPipedOutput>(),
    }));
    vi.doMock(
      '../src/system-domain',
      async (importOriginal: () => Promise<typeof SystemDomainModule>): Promise<typeof SystemDomainModule> => {
        const actual: typeof SystemDomainModule = await importOriginal();
        return {
          ...actual,
          getSelfHostedSystemDomainStatus: vi
            .fn<GetSelfHostedSystemDomainStatus>()
            .mockRejectedValue(new privilegesModule.SelfHostedSystemPrivilegesError()),
        };
      },
    );
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    const result: CliCommandResult = await runCliCommand(['system', 'domain', 'status'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain('System self-hosted command requires root; re-running with sudo.');
    const rerunCommand: readonly string[] = runInheritedCommandMock.mock.calls[0]?.[0] ?? [];
    expect(rerunCommand[0]).toBe('sudo');
    expect(rerunCommand.slice(-3)).toEqual(['system', 'domain', 'status']);
  });

  it('surfaces system restart runtime errors', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock('../src/system-restart', (): { restartSelfHostedSystem: Mock<RestartSelfHostedSystem> } => ({
      restartSelfHostedSystem: vi.fn<RestartSelfHostedSystem>().mockRejectedValue(new Error('Restart failed.')),
    }));

    const result: CliCommandResult = await runCliCommand(['system', 'restart']);

    expectCliFailure(result, 'Restart failed.');
  });

  it('stages a custom domain and prints DNS instructions', async (): Promise<void> => {
    resetCliCommandModules();
    const setSelfHostedSystemDomainMock: Mock<SetSelfHostedSystemDomain> = vi
      .fn<SetSelfHostedSystemDomain>()
      .mockResolvedValue(createSystemDomainSetResponse());
    vi.doMock(
      '../src/system-domain',
      async (importOriginal: () => Promise<typeof SystemDomainModule>): Promise<typeof SystemDomainModule> => {
        const actual: typeof SystemDomainModule = await importOriginal();
        return {
          ...actual,
          setSelfHostedSystemDomain: setSelfHostedSystemDomainMock,
        };
      },
    );

    const result: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'set',
      '--base-domain',
      'customer.example.com',
      '--public-scheme',
      'https',
    ]);

    expectCliSuccess(result);
    expect(setSelfHostedSystemDomainMock.mock.calls[0]?.[0]).toMatchObject({
      baseDomain: 'customer.example.com',
      publicScheme: 'https',
      tlsMode: 'external',
    });
    expect(readCliStdout(result.capture)).toContain(
      'Pending domain: console.customer.example.com; apps *.customer.example.com; status pending_dns.',
    );
    expect(readCliStdout(result.capture)).toContain(
      '- TXT _compartment-domain.customer.example.com -> compartment-domain-verification=domop_123; ownership.',
    );
    expect(readCliStdout(result.capture)).toContain('- A console.customer.example.com -> 203.0.113.10; routing.');
  });

  it('rejects invalid system domain flags', async (): Promise<void> => {
    const schemeResult: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'set',
      '--base-domain',
      'customer.example.com',
      '--public-scheme',
      'ftp',
    ]);
    const versionResult: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'verify',
      '--expected-version',
      'latest',
    ]);
    const tlsResult: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'set',
      '--base-domain',
      'customer.example.com',
      '--tls',
      'managed',
    ]);
    const customCertHttpResult: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'set',
      '--base-domain',
      'customer.example.com',
      '--tls',
      'custom-cert',
      '--public-scheme',
      'http',
    ]);
    const externalHttpResult: CliCommandResult = await runCliCommand([
      'system',
      'domain',
      'set',
      '--base-domain',
      'customer.example.com',
      '--tls',
      'external',
      '--public-scheme',
      'http',
    ]);

    expectCliFailure(schemeResult, 'Expected --public-scheme to be http or https.');
    expectCliFailure(tlsResult, 'Expected --tls to be external or custom-cert.');
    expectCliFailure(customCertHttpResult, 'Expected --public-scheme to be https for browser auth cookies.');
    expectCliFailure(externalHttpResult, 'Expected --public-scheme to be https for browser auth cookies.');
    expectCliFailure(versionResult, 'Expected --expected-version to be a non-negative integer.');
  });
});

function createSystemDomainSetResponse(): SystemDomainMutationResponse {
  return {
    operationId: 'domop_123',
    setupVersion: 1,
    status: {
      active: {
        baseDomain: 'localhost',
        caddyMode: 'internal',
        domainKind: 'local',
        publicScheme: 'http',
        tlsMode: 'internal',
      },
      activeDomainHealth: {
        checkedAt: null,
        failureCode: null,
        failureMessage: null,
        status: 'unknown',
      },
      pending: {
        certificate: null,
        failureCode: null,
        failureMessage: null,
        hostPlan: {
          baseDomain: 'customer.example.com',
          caddyMode: 'custom-http',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'external',
        },
        operationId: 'domop_123',
        requiredDnsRecords: [
          {
            groupId: 'ownership',
            name: '_compartment-domain.customer.example.com',
            purpose: 'ownership',
            recordType: 'TXT',
            required: true,
            value: 'compartment-domain-verification=domop_123',
          },
          {
            groupId: 'routing',
            name: 'console.customer.example.com',
            purpose: 'routing',
            recordType: 'A',
            required: true,
            value: '203.0.113.10',
          },
          {
            groupId: 'routing',
            name: '*.customer.example.com',
            purpose: 'routing',
            recordType: 'A',
            required: true,
            value: '203.0.113.10',
          },
        ],
        status: 'pending_dns',
      },
      setupVersion: 1,
    },
  };
}

function createSystemStatusResponse(): SystemStatusResponse {
  return {
    checkedAt: '2026-04-09T12:00:00.000Z',
    configDir: '/tmp/compartment/etc',
    dataDir: '/tmp/compartment/var',
    domain: {
      cliApiUrl: 'http://127.0.0.1:39444',
      controlPlaneUrl: 'https://console.customer.example.com',
    },
    dockerNamespace: 'compartment-prod',
    imageRegistry: 'github',
    imageSource: 'registry',
    overallStatus: 'degraded',
    rollbackRetention: {
      limit: null,
      mode: 'indefinite',
    },
    services: [
      {
        containerId: 'container_api',
        health: 'unhealthy',
        imageRef: 'ghcr.io/compartmentdev/compartment-api:0.2.0',
        name: 'api',
        publishedPorts: [{ containerPort: 39444, hostIp: '127.0.0.1', hostPort: 39444 }],
        startedAt: '2026-04-09T11:00:00.000Z',
        status: 'running',
        uptimeSeconds: 3600,
      },
    ],
  };
}

function createIssuePasswordResetResponse(): IssuePasswordResetResponse {
  return {
    email: 'viewer@example.com',
    expiresAt: '2026-04-29T12:00:00.000Z',
    resetToken: 'reset-token',
    resetUrl: 'https://console.example.com/reset-password?email=viewer%40example.com&token=reset-token',
  };
}

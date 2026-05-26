import { updateResponseSchema, type UpdateResponse } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
  type CliCommandCapture,
  type CliJsonResult,
  type CliCommandResult,
} from './cli-test.harness';
import type { SelfHostedUpdateInput, SelfHostedUpdateResult } from '../src/update.types';

type UpdateSelfHosted = (input: SelfHostedUpdateInput) => Promise<SelfHostedUpdateResult>;
type AssertNodeAgentHostServiceInstallable = () => void;
type ExecuteSelfHostedSystemCommandWithSudoFallback = (
  dependencies: object,
  command: () => Promise<void>,
) => Promise<void>;

const nodeAgentServiceMocks: {
  assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
} = vi.hoisted(
  (): {
    assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable>;
  } => ({
    assertNodeAgentHostServiceInstallable: vi.fn<AssertNodeAgentHostServiceInstallable>(),
  }),
);

vi.mock(
  '../src/node-agent-service',
  (): { assertNodeAgentHostServiceInstallable: Mock<AssertNodeAgentHostServiceInstallable> } => ({
    assertNodeAgentHostServiceInstallable: nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable,
  }),
);

describe.sequential('compartment system update command boundary validation', (): void => {
  beforeEach((): void => {
    nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable.mockReset();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/update', '../src/commands/system/system.command.sudo']);
  });

  it('removes the top-level update command and does not register an upgrade alias', async (): Promise<void> => {
    const legacyUpdateResult: CliCommandResult = await runCliCommand(['update']);
    const aliasResult: CliCommandResult = await runCliCommand(['upgrade']);

    expectCliFailure(legacyUpdateResult, "unknown command 'update'");
    expectCliFailure(aliasResult, "unknown command 'upgrade'");
  });

  it('rejects invalid update image sources', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'update', '--image-source', 'broken']);

    expectCliFailure(result, 'Install image source must be `registry` or `local` when provided.');
  });

  it('rejects invalid update image registries', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'update', '--image-registry', 'broken']);

    expectCliFailure(result, 'Self-hosted image registry must be `github` or `docker-hub` when provided.');
  });

  it('rejects invalid update version selectors', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'update', '--version', 'broken']);

    expectCliFailure(
      result,
      'Install version must be `latest`, `main`, `sha-<commit>`, or an exact release like `0.2.0`.',
    );
  });

  it('passes explicit update versions to the runtime update service', async (): Promise<void> => {
    resetCliCommandModules();
    const updateSelfHostedMock: Mock<UpdateSelfHosted> = vi.fn<UpdateSelfHosted>().mockResolvedValue({
      backupDir: '/tmp/compartment/var/self-hosted/backups/runtime-2026-04-09',
      configDir: '/tmp/compartment/etc',
      currentVersion: '0.1.0',
      dataDir: '/tmp/compartment/var',
      imageRegistry: 'github',
      imageSource: 'local',
      skipReason: null,
      status: 'updated',
      targetVersion: '9.9.9',
    });
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: updateSelfHostedMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand(['system', 'update', '--version', '9.9.9']);

    expectCliSuccess(result);
    expect(updateSelfHostedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          version: '9.9.9',
        },
      }),
    );
  });

  it('passes explicit update image registries to the runtime update service', async (): Promise<void> => {
    resetCliCommandModules();
    const updateSelfHostedMock: Mock<UpdateSelfHosted> = vi.fn<UpdateSelfHosted>().mockResolvedValue({
      backupDir: '/tmp/compartment/var/self-hosted/backups/runtime-2026-04-09',
      configDir: '/tmp/compartment/etc',
      currentVersion: '0.1.0',
      dataDir: '/tmp/compartment/var',
      imageRegistry: 'docker-hub',
      imageSource: 'registry',
      skipReason: null,
      status: 'updated',
      targetVersion: '0.2.0',
    });
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: updateSelfHostedMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand(['system', 'update', '--image-registry', 'docker-hub']);

    expectCliSuccess(result);
    expect(updateSelfHostedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          imageRegistry: 'docker-hub',
          version: 'latest',
        },
      }),
    );
  });

  it('rejects explicit registry version mismatches before running the update service', async (): Promise<void> => {
    resetCliCommandModules();
    const updateSelfHostedMock: Mock<UpdateSelfHosted> = vi.fn<UpdateSelfHosted>();
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: updateSelfHostedMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand([
      'system',
      'update',
      '--image-source',
      'registry',
      '--version',
      '9.9.9',
    ]);

    expectCliFailure(
      result,
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );
    expect(updateSelfHostedMock).not.toHaveBeenCalled();
  });

  it('rejects non-packaged self-hosted updates before sudo fallback', async (): Promise<void> => {
    resetCliCommandModules();
    const updateSelfHostedMock: Mock<UpdateSelfHosted> = vi.fn<UpdateSelfHosted>();
    const sudoFallbackMock: Mock<ExecuteSelfHostedSystemCommandWithSudoFallback> =
      vi.fn<ExecuteSelfHostedSystemCommandWithSudoFallback>();
    nodeAgentServiceMocks.assertNodeAgentHostServiceInstallable.mockImplementationOnce((): never => {
      throw new Error('compartment-node-agent can only be installed from the self-contained compartment binary.');
    });
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: updateSelfHostedMock,
      }),
    );
    vi.doMock(
      '../src/commands/system/system.command.sudo',
      (): {
        executeSelfHostedSystemCommandWithSudoFallback: Mock<ExecuteSelfHostedSystemCommandWithSudoFallback>;
      } => ({
        executeSelfHostedSystemCommandWithSudoFallback: sudoFallbackMock,
      }),
    );

    const result: CliCommandResult = await runCliCommand(['system', 'update']);

    expectCliFailure(
      result,
      'compartment-node-agent can only be installed from the self-contained compartment binary.',
    );
    expect(sudoFallbackMock).not.toHaveBeenCalled();
    expect(updateSelfHostedMock).not.toHaveBeenCalled();
  });

  it('rejects removed custom update path flags', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['system', 'update', '--config-dir', '/tmp/compartment/etc']);

    expectCliFailure(result, "unknown option '--config-dir'");
  });

  it('registers system update and preserves the update response contract', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: vi.fn<UpdateSelfHosted>().mockResolvedValue({
          backupDir: '/tmp/compartment/var/self-hosted/backups/runtime-2026-04-09',
          configDir: '/tmp/compartment/etc',
          currentVersion: '0.1.0',
          dataDir: '/tmp/compartment/var',
          imageRegistry: 'github',
          imageSource: 'registry',
          skipReason: null,
          status: 'updated',
          targetVersion: '0.2.0',
        }),
      }),
    );

    const jsonResult: CliJsonResult<UpdateResponse> = await runCliJson(['system', 'update', '--output', 'json'], {
      parse: (value: JsonValue): UpdateResponse => updateResponseSchema.parse(value),
    });
    const textResult: CliCommandResult = await runCliCommand(['system', 'update']);

    expectCliSuccess(jsonResult);
    expect(jsonResult.payload.configDir).toBe('/tmp/compartment/etc');
    expect(jsonResult.payload.dataDir).toBe('/tmp/compartment/var');
    expectCliSuccess(textResult);
    expect(readCliStdout(textResult.capture)).toContain(
      'Updated self-hosted runtime using config /tmp/compartment/etc and data /tmp/compartment/var.',
    );
    expect(readCliStdout(textResult.capture)).toContain('Version: 0.1.0 -> 0.2.0.');
    expect(readCliStdout(textResult.capture)).toContain('Image source: registry.');
    expect(readCliStdout(textResult.capture)).toContain('Image registry: github.');
  });

  it('renders update progress for text output without polluting JSON output', async (): Promise<void> => {
    resetCliCommandModules();
    const updateResult: SelfHostedUpdateResult = {
      backupDir: '/tmp/compartment/var/self-hosted/backups/runtime-2026-04-09',
      configDir: '/tmp/compartment/etc',
      currentVersion: '0.1.0',
      dataDir: '/tmp/compartment/var',
      imageRegistry: 'github',
      imageSource: 'registry',
      skipReason: null,
      status: 'updated',
      targetVersion: '0.2.0',
    };
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: vi
          .fn<UpdateSelfHosted>()
          .mockImplementation(async (input: SelfHostedUpdateInput): Promise<SelfHostedUpdateResult> => {
            input.context?.reportProgress?.('Preparing runtime images...');
            await Promise.resolve();
            return updateResult;
          }),
      }),
    );
    const jsonCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    const textCapture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });

    const jsonResult: CliJsonResult<UpdateResponse> = await runCliJson(
      ['system', 'update', '--output', 'json'],
      {
        parse: (value: JsonValue): UpdateResponse => updateResponseSchema.parse(value),
      },
      jsonCapture,
    );
    const textResult: CliCommandResult = await runCliCommand(['system', 'update'], textCapture);

    expectCliSuccess(jsonResult);
    expect(readCliStderr(jsonCapture)).toBe('');
    expectCliSuccess(textResult);
    expect(readCliStderr(textCapture)).toBe('Preparing runtime images...\n');
  });

  it('renders a skipped update as a no-op', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: vi.fn<UpdateSelfHosted>().mockResolvedValue({
          backupDir: null,
          configDir: '/tmp/compartment/etc',
          currentVersion: '0.2.0',
          dataDir: '/tmp/compartment/var',
          imageRegistry: 'github',
          imageSource: 'registry',
          skipReason: 'downgrade-not-supported',
          status: 'skipped',
          targetVersion: '0.1.0',
        }),
      }),
    );

    const result: CliCommandResult = await runCliCommand(['system', 'update']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain(
      'Skipped self-hosted runtime update using config /tmp/compartment/etc and data /tmp/compartment/var.',
    );
    expect(readCliStdout(result.capture)).toContain('Requested version: 0.1.0.');
    expect(readCliStdout(result.capture)).toContain('Current version: 0.2.0.');
    expect(readCliStdout(result.capture)).toContain(
      'Self-hosted downgrades are not supported. No changes were applied.',
    );
    expect(readCliStdout(result.capture)).toContain('Requested image source: registry.');
    expect(readCliStdout(result.capture)).toContain('Requested image registry: github.');
  });

  it('surfaces update runtime errors', async (): Promise<void> => {
    resetCliCommandModules();
    vi.doMock(
      '../src/update',
      (): {
        updateSelfHosted: Mock<UpdateSelfHosted>;
      } => ({
        updateSelfHosted: vi
          .fn<UpdateSelfHosted>()
          .mockRejectedValue(new Error('Update failed after reporting progress.')),
      }),
    );
    const capture: CliCommandCapture = createCliCapture({
      isTTY: true,
    });

    const result: CliCommandResult = await runCliCommand(['system', 'update', '--image-source', 'registry'], capture);

    expectCliFailure(result, 'Update failed after reporting progress.');
    expect(readCliStderr(capture)).toContain('Update failed after reporting progress.');
  });
});

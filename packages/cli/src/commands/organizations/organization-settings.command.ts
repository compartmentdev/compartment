import type {
  OrganizationSettingsResponse,
  OrganizationSettingsAuditRetentionSummary,
  OrganizationSettingsRollbackRetentionSummary,
  AuditRetentionConfiguredPolicy,
  RollbackRetentionConfiguredPolicy,
  UpdateOrganizationSettingsRequest,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import {
  readOrganizationSettings,
  updateCurrentOrganizationSettings,
} from '../../services/organization-settings.service';
import { formatAuditRetentionPolicy } from '../../services/audit-retention-output.service';
import { formatRollbackRetentionPolicy } from '../../services/rollback-retention-output.service';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

interface OrganizationSettingsSetCommandOptions extends OutputOnlyOptions {
  auditRetention?: string | undefined;
  rollbackRetention?: string | undefined;
}

export function registerOrganizationSettingsCommands(program: Command, dependencies: CliCommandDependencies): void {
  const settingsCommand: Command = program.command('settings').description('Organization deployment settings');
  registerGetOrganizationSettingsCommand(settingsCommand, dependencies);
  registerSetOrganizationSettingsCommand(settingsCommand, dependencies);
}

function registerGetOrganizationSettingsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('get').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> =>
      await executeGetOrganizationSettingsCommand(dependencies, options),
  );
}

function registerSetOrganizationSettingsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('set')
      .option('--rollback-retention <value>', 'inherit, indefinite, or a positive integer')
      .option('--audit-retention <value>', 'inherit, indefinite, or positive days')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: OrganizationSettingsSetCommandOptions): Promise<void> =>
      await executeSetOrganizationSettingsCommand(dependencies, options),
  );
}

async function executeGetOrganizationSettingsCommand(
  dependencies: CliCommandDependencies,
  options: OutputOnlyOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const response: OrganizationSettingsResponse = await readOrganizationSettings(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
  );

  renderOutput(dependencies.io, options.output, response, createOrganizationSettingsMessage(response));
}

async function executeSetOrganizationSettingsCommand(
  dependencies: CliCommandDependencies,
  options: OrganizationSettingsSetCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const response: OrganizationSettingsResponse = await updateCurrentOrganizationSettings(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
    buildUpdateOrganizationSettingsRequest(options),
  );

  renderOutput(dependencies.io, options.output, response, createOrganizationSettingsMessage(response));
}

function buildUpdateOrganizationSettingsRequest(
  options: OrganizationSettingsSetCommandOptions,
): UpdateOrganizationSettingsRequest {
  if (options.rollbackRetention === undefined && options.auditRetention === undefined) {
    throw new Error('Set at least one of --rollback-retention or --audit-retention.');
  }

  return {
    ...(options.auditRetention === undefined
      ? {}
      : { auditRetention: parseAuditRetentionPolicy(options.auditRetention) }),
    ...(options.rollbackRetention === undefined
      ? {}
      : { rollbackRetention: parseRollbackRetentionPolicy(options.rollbackRetention) }),
  };
}

function parseAuditRetentionPolicy(value: string): AuditRetentionConfiguredPolicy {
  if (value === 'inherit' || value === 'indefinite') {
    return {
      days: null,
      mode: value,
    };
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('audit retention must be inherit, indefinite, or positive days.');
  }

  return {
    days: Number(value),
    mode: 'keep_days',
  };
}

function parseRollbackRetentionPolicy(value: string): RollbackRetentionConfiguredPolicy {
  if (value === 'inherit' || value === 'indefinite') {
    return {
      limit: null,
      mode: value,
    };
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('rollback retention must be inherit, indefinite, or a positive integer.');
  }

  const limit: number = Number(value);
  return {
    limit,
    mode: 'keep_last',
  };
}

function createOrganizationSettingsMessage(response: OrganizationSettingsResponse): string {
  const auditRetention: OrganizationSettingsAuditRetentionSummary = response.settings.auditRetention;
  const rollbackRetention: OrganizationSettingsRollbackRetentionSummary = response.settings.rollbackRetention;

  return `Rollback retention configured: ${formatRollbackRetentionPolicy(rollbackRetention.configured)}.
Rollback retention effective: ${formatRollbackRetentionPolicy(rollbackRetention.effective)}.
Rollback retention instance default: ${formatRollbackRetentionPolicy(rollbackRetention.instanceDefault)}.
Audit retention configured: ${formatAuditRetentionPolicy(auditRetention.configured)}.
Audit retention effective: ${formatAuditRetentionPolicy(auditRetention.effective)}.
Audit retention instance default: ${formatAuditRetentionPolicy(auditRetention.instanceDefault)}.`;
}

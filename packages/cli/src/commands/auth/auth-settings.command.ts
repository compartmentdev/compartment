import type { OrganizationAuthSettingsResponse, UpdateOrganizationAuthSettingsRequest } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import {
  readOrganizationAuthSettings,
  updateCurrentOrganizationAuthSettings,
} from '../../services/organization-auth-settings.service';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

interface AuthSettingsSetCommandOptions extends OutputOnlyOptions {
  password: 'disabled' | 'enabled';
}

export function registerAuthSettingsCommands(program: Command, dependencies: CliCommandDependencies): void {
  const settingsCommand: Command = program.command('settings').description('Organization login settings');
  registerGetAuthSettingsCommand(settingsCommand, dependencies);
  registerSetAuthSettingsCommand(settingsCommand, dependencies);
}

function registerGetAuthSettingsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('get').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => await executeGetAuthSettingsCommand(dependencies, options),
  );
}

function registerSetAuthSettingsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('set')
      .requiredOption('--password <state>', 'enabled or disabled')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: AuthSettingsSetCommandOptions): Promise<void> =>
      await executeSetAuthSettingsCommand(dependencies, options),
  );
}

async function executeGetAuthSettingsCommand(
  dependencies: CliCommandDependencies,
  options: OutputOnlyOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const response: OrganizationAuthSettingsResponse = await readOrganizationAuthSettings(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
  );

  renderOutput(dependencies.io, options.output, response, createAuthSettingsMessage(response));
}

async function executeSetAuthSettingsCommand(
  dependencies: CliCommandDependencies,
  options: AuthSettingsSetCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const response: OrganizationAuthSettingsResponse = await updateCurrentOrganizationAuthSettings(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
    buildUpdateOrganizationAuthSettingsRequest(options),
  );

  renderOutput(dependencies.io, options.output, response, createAuthSettingsMessage(response));
}

function buildUpdateOrganizationAuthSettingsRequest(
  options: AuthSettingsSetCommandOptions,
): UpdateOrganizationAuthSettingsRequest {
  return {
    localPasswordEnabled: options.password === 'enabled',
  };
}

function createAuthSettingsMessage(response: OrganizationAuthSettingsResponse): string {
  const passwordState: string = response.settings.localPasswordEnabled ? 'enabled' : 'disabled';

  return `Password login is ${passwordState} for the current organization.`;
}

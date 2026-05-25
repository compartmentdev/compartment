import type { GitSourceSettingsResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import type { AuthenticatedContext } from '../../services/context.types';
import { readSourceSettings, updateSourceSettingsForSource } from '../../services/sources.service';
import type { CliCommandDependencies, OutputOnlyOptions, SourceSettingsSetCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createGitSourceSettingsMessage, parseEnabledDisabledState } from './source.command.helpers';

export function registerSourceSettingsCommands(program: Command, dependencies: CliCommandDependencies): void {
  const settingsCommand: Command = program.command('settings').description('Git source settings');

  addRemoteOption(settingsCommand.command('get <sourceId>').option('--output <format>', 'text or json', 'text')).action(
    async (sourceId: string, options: OutputOnlyOptions): Promise<void> => {
      const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
      const response: GitSourceSettingsResponse = await readSourceSettings(context, sourceId);
      renderOutput(dependencies.io, options.output, response, createGitSourceSettingsMessage(sourceId, response));
    },
  );

  addRemoteOption(
    settingsCommand
      .command('set <sourceId>')
      .requiredOption('--auto-adopt-new-apps <state>', 'enabled or disabled')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (sourceId: string, options: SourceSettingsSetCommandOptions): Promise<void> => {
    const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
    const response: GitSourceSettingsResponse = await updateSourceSettingsForSource(context, sourceId, {
      autoAdoptNewApps: parseStateOption(options.autoAdoptNewApps),
    });
    renderOutput(dependencies.io, options.output, response, createGitSourceSettingsMessage(sourceId, response));
  });
}

function parseStateOption(value: string): boolean {
  return parseEnabledDisabledState(value, '--auto-adopt-new-apps');
}

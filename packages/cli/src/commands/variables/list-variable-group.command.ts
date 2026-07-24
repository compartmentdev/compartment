import { Option, type Command } from 'commander';
import type { VariableGroupListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listVariableGroups } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupListCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableGroupListMessage } from './variable-group.command.output';

const invalidVariableGroupScopeMessage: string =
  'Variable groups are organization-scoped; --project, --service, and --env are not applicable.';

export function registerListVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('list')
      .option('--output <format>', 'text or json', 'text')
      .addOption(new Option('--project <project>').hideHelp())
      .addOption(new Option('--service <service>').hideHelp())
      .addOption(new Option('--env <environment>').hideHelp()),
  ).action(async (options: VariableGroupListCommandOptions): Promise<void> => {
    if (options.project !== undefined || options.service !== undefined || options.env !== undefined) {
      throw new Error(invalidVariableGroupScopeMessage);
    }

    const response: VariableGroupListResponse = await listVariableGroups(
      await createRemoteAuthenticatedContext(options),
    );
    renderOutput(dependencies.io, options.output, response, createVariableGroupListMessage(response));
  });
}

import type { Command } from 'commander';
import type { AccessGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { deleteOrganizationAccessGroup } from '../../services/rbac.service';
import type { CliCommandDependencies, ConfirmedOutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

const missingGroupDeleteConfirmationMessage: string = 'Group delete requires --yes.';

export function registerDeleteGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('delete <groupId>')
      .option('--output <format>', 'text or json', 'text')
      .option('--yes', 'confirm group deletion'),
  ).action(async (groupId: string, options: ConfirmedOutputOnlyOptions): Promise<void> => {
    if (options.yes !== true) {
      throw new Error(missingGroupDeleteConfirmationMessage);
    }

    const response: AccessGroupResponse = await deleteOrganizationAccessGroup(
      await createRemoteAuthenticatedContext(options),
      groupId,
    );

    renderOutput(dependencies.io, options.output, response, `Deleted group ${response.group.name}.`);
  });
}

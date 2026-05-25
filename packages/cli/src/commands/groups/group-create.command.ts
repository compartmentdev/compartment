import type { Command } from 'commander';
import type { AccessGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createOrganizationAccessGroup } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerCreateGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('create <name>').option('--output <format>', 'text or json', 'text')).action(
    async (name: string, options: OutputOnlyOptions): Promise<void> => {
      const response: AccessGroupResponse = await createOrganizationAccessGroup(
        await createRemoteAuthenticatedContext(options),
        { name },
      );

      renderOutput(dependencies.io, options.output, response, `Created group ${response.group.name}.`);
    },
  );
}

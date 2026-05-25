import type { Command } from 'commander';
import type { AccessAssignmentResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { deleteOrganizationAccessAssignment } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerDeleteAssignmentCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('delete <assignmentId>').option('--output <format>', 'text or json', 'text')).action(
    async (assignmentId: string, options: OutputOnlyOptions): Promise<void> => {
      const response: AccessAssignmentResponse = await deleteOrganizationAccessAssignment(
        await createRemoteAuthenticatedContext(options),
        assignmentId,
      );

      renderOutput(dependencies.io, options.output, response, `Deleted assignment ${response.assignment.id}.`);
    },
  );
}

import type { Command } from 'commander';
import type { AccessAssignmentResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { deleteOrganizationAccessAssignment } from '../../services/rbac.service';
import type { CliCommandDependencies, ConfirmedOutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

const missingAssignmentDeleteConfirmationMessage: string = 'Assignment delete requires --yes.';

export function registerDeleteAssignmentCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('delete <assignmentId>')
      .option('--output <format>', 'text or json', 'text')
      .option('--yes', 'confirm assignment deletion'),
  ).action(async (assignmentId: string, options: ConfirmedOutputOnlyOptions): Promise<void> => {
    if (options.yes !== true) {
      throw new Error(missingAssignmentDeleteConfirmationMessage);
    }

    const response: AccessAssignmentResponse = await deleteOrganizationAccessAssignment(
      await createRemoteAuthenticatedContext(options),
      assignmentId,
    );

    renderOutput(dependencies.io, options.output, response, `Deleted assignment ${response.assignment.id}.`);
  });
}

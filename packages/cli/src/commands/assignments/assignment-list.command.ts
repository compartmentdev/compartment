import type { Command } from 'commander';
import type {
  AccessAssignmentListResponse,
  AccessAssignmentScopeTarget,
  AccessAssignmentSummary,
} from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listOrganizationAccessAssignments } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerListAssignmentCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      const response: AccessAssignmentListResponse = await listOrganizationAccessAssignments(
        await createRemoteAuthenticatedContext(options),
      );
      const text: string =
        response.assignments.length === 0
          ? 'No assignments found.'
          : response.assignments.map(formatAssignmentRow).join('\n');

      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}

function formatAssignmentRow(assignment: AccessAssignmentSummary): string {
  return `${assignment.id}\t${assignment.roleName}\t${formatScope(assignment.scope)}\t${formatSubject(assignment)}`;
}

function formatScope(scope: AccessAssignmentScopeTarget): string {
  if (scope.scopeType === 'organization') return 'organization';
  if (scope.scopeType === 'project') return `project:${scope.projectName}`;
  return `environment:${scope.projectName}/${scope.environmentName}`;
}

function formatSubject(assignment: AccessAssignmentSummary): string {
  return assignment.subject.subjectType === 'group'
    ? `group:${assignment.subject.groupName}`
    : `user:${assignment.subject.principalEmail}`;
}

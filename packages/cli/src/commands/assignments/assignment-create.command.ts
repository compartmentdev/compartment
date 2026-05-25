import type { Command } from 'commander';
import type {
  AccessAssignmentResponse,
  AccessAssignmentScopeTarget,
  AccessAssignmentScopeType,
  CreateAccessAssignmentRequest,
} from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createOrganizationAccessAssignment } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

interface AssignmentCreateCommandOptions extends OutputOnlyOptions {
  environment?: string | undefined;
  group?: string | undefined;
  project?: string | undefined;
  role: string;
  scope: AccessAssignmentScopeType;
  user?: string | undefined;
}

export function registerCreateAssignmentCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('create')
      .requiredOption('--role <roleId>')
      .requiredOption('--scope <scopeType>')
      .option('--group <groupId>')
      .option('--user <email>')
      .option('--project <projectName>')
      .option('--environment <environmentName>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: AssignmentCreateCommandOptions): Promise<void> => {
    const response: AccessAssignmentResponse = await createOrganizationAccessAssignment(
      await createRemoteAuthenticatedContext(options),
      buildCreateAssignmentRequest(options),
    );

    renderOutput(dependencies.io, options.output, response, `Created assignment ${response.assignment.id}.`);
  });
}

function buildCreateAssignmentRequest(options: AssignmentCreateCommandOptions): CreateAccessAssignmentRequest {
  if (options.group === undefined && options.user === undefined) {
    throw new Error('Specify either --group or --user.');
  }
  if (options.group !== undefined && options.user !== undefined) {
    throw new Error('Use either --group or --user, not both.');
  }

  return {
    roleId: options.role,
    scope: buildScope(options),
    subject:
      options.group !== undefined
        ? { groupId: options.group, subjectType: 'group' }
        : { principalEmail: options.user!, subjectType: 'principal' },
  };
}

function buildScope(options: AssignmentCreateCommandOptions): AccessAssignmentScopeTarget {
  switch (options.scope) {
    case 'organization':
      return { scopeType: 'organization' };
    case 'project':
      if (options.project === undefined) throw new Error('--project is required for project scope.');
      return { projectName: options.project, scopeType: 'project' };
    case 'environment':
      if (options.project === undefined || options.environment === undefined) {
        throw new Error('--project and --environment are required for environment scope.');
      }
      return { environmentName: options.environment, projectName: options.project, scopeType: 'environment' };
    default:
      throw new Error('Scope must be organization, project, or environment.');
  }
}

import type { Command } from 'commander';
import type { ProjectResponse } from '@compartment/contracts';
import { unarchiveProject } from '../../services/projects.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, ProjectCommandOptions } from '../command.types';
import { createUnarchiveProjectMessage, registerProjectScopedCommand } from './project.command.helpers';

export function registerUnarchiveProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerProjectScopedCommand<ProjectResponse>(program, dependencies, {
    commandName: 'unarchive',
    createMessage: createUnarchiveProjectMessage,
    execute: async (context: AuthenticatedContext, options: ProjectCommandOptions): Promise<ProjectResponse> =>
      await unarchiveProject(context, {
        cwd: process.cwd(),
        projectName: options.project,
      }),
  });
}

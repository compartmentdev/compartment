import type { Command } from 'commander';
import { projectShowResponseSchema, type ProjectShowResponse } from '@compartment/contracts';
import { showProject } from '../../services/projects.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, ProjectCommandOptions } from '../command.types';
import { createProjectShowMessage, registerProjectScopedCommand } from './project.command.helpers';

export function registerShowProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerProjectScopedCommand<ProjectShowResponse>(program, dependencies, {
    commandName: 'show',
    createMessage: createProjectShowMessage,
    execute: async (context: AuthenticatedContext, options: ProjectCommandOptions): Promise<ProjectShowResponse> =>
      projectShowResponseSchema.parse(
        await showProject(context, {
          cwd: process.cwd(),
          projectName: options.project,
        }),
      ),
  });
}

import type { ProjectLifecycleResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { startProject } from '../../services/projects.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, ProjectLifecycleCommandOptions } from '../command.types';
import { createStartProjectMessage, registerProjectScopedCommand } from './project.command.helpers';

export function registerStartProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerProjectScopedCommand<ProjectLifecycleResponse, ProjectLifecycleCommandOptions>(program, dependencies, {
    commandName: 'start',
    configureCommand: (command: Command): Command => command.option('--env <name>'),
    createMessage: createStartProjectMessage,
    execute: async (
      context: AuthenticatedContext,
      options: ProjectLifecycleCommandOptions,
    ): Promise<ProjectLifecycleResponse> =>
      await startProject(context, {
        cwd: process.cwd(),
        environmentName: options.env,
        projectName: options.project,
      }),
  });
}

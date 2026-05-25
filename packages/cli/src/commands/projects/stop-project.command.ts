import type { ProjectLifecycleResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { stopProject } from '../../services/projects.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, ProjectLifecycleCommandOptions } from '../command.types';
import { createStopProjectMessage, registerProjectScopedCommand } from './project.command.helpers';

export function registerStopProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerProjectScopedCommand<ProjectLifecycleResponse, ProjectLifecycleCommandOptions>(program, dependencies, {
    commandName: 'stop',
    configureCommand: (command: Command): Command => command.option('--env <name>'),
    createMessage: createStopProjectMessage,
    execute: async (
      context: AuthenticatedContext,
      options: ProjectLifecycleCommandOptions,
    ): Promise<ProjectLifecycleResponse> =>
      await stopProject(context, {
        cwd: process.cwd(),
        environmentName: options.env,
        projectName: options.project,
      }),
  });
}

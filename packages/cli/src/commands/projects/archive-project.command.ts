import type { Command } from 'commander';
import type { ProjectResponse } from '@compartment/contracts';
import { archiveProject } from '../../services/projects.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { resolveProjectTarget } from '../../services/project-target.service';
import type { ArchiveProjectCommandOptions, CliCommandDependencies } from '../command.types';
import { createArchiveProjectMessage, registerProjectScopedCommand } from './project.command.helpers';

const missingProjectArchiveConfirmationMessage: string = 'Project archive requires --yes.';

export function registerArchiveProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  registerProjectScopedCommand<ProjectResponse, ArchiveProjectCommandOptions>(program, dependencies, {
    commandName: 'archive',
    configureCommand: (command: Command): Command => command.option('--yes', 'confirm project archive'),
    createMessage: createArchiveProjectMessage,
    execute: async (context: AuthenticatedContext, options: ArchiveProjectCommandOptions): Promise<ProjectResponse> =>
      await archiveProject(context, {
        cwd: process.cwd(),
        projectName: options.project,
      }),
    validateOptions: async (options: ArchiveProjectCommandOptions): Promise<void> => {
      await resolveProjectTarget(process.cwd(), options.project);
      if (options.yes !== true) {
        throw new Error(missingProjectArchiveConfirmationMessage);
      }
    },
  });
}

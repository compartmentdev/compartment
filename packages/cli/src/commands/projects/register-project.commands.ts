import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerArchiveProjectCommand } from './archive-project.command';
import { registerDeleteProjectCommand } from './delete-project.command';
import { registerListProjectsCommand } from './list-projects.command';
import { registerRenameProjectCommand } from './rename-project.command';
import { registerShowProjectCommand } from './show-project.command';
import { registerStartProjectCommand } from './start-project.command';
import { registerStopProjectCommand } from './stop-project.command';
import { registerUnarchiveProjectCommand } from './unarchive-project.command';

export function registerProjectCommands(program: Command, dependencies: CliCommandDependencies): void {
  const projectCommand: Command = program.command('project').description('Project commands');
  registerListProjectsCommand(projectCommand, dependencies);
  registerShowProjectCommand(projectCommand, dependencies);
  registerRenameProjectCommand(projectCommand, dependencies);
  registerArchiveProjectCommand(projectCommand, dependencies);
  registerStartProjectCommand(projectCommand, dependencies);
  registerStopProjectCommand(projectCommand, dependencies);
  registerDeleteProjectCommand(projectCommand, dependencies);
  registerUnarchiveProjectCommand(projectCommand, dependencies);
}

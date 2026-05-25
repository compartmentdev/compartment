import { hasText } from '@compartment/utils';
import type { ProjectDeleteResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { deleteProject } from '../../services/projects.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, DeleteProjectCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import { assertValidProjectName, createDeleteProjectMessage } from './project.command.helpers';

const missingProjectDeleteConfirmationMessage: string = 'Project delete requires --yes.';
const missingProjectDeleteTargetMessage: string = 'Project delete requires --project <slug>.';

export function registerDeleteProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('delete')
      .option('--project <name>')
      .option('--yes', 'confirm remote project deletion')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: DeleteProjectCommandOptions): Promise<void> =>
      await executeDeleteProjectCommand(dependencies, options),
  );
}

async function executeDeleteProjectCommand(
  dependencies: CliCommandDependencies,
  options: DeleteProjectCommandOptions,
): Promise<void> {
  const projectName: string = readRequiredProjectName(options.project);
  assertValidRemoteOption(options);
  if (options.yes !== true) {
    throw new Error(missingProjectDeleteConfirmationMessage);
  }

  const config: CliConfig = await readCliConfig();
  const response: ProjectDeleteResponse = await deleteProject(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
    projectName,
  );

  renderOutput(dependencies.io, options.output, response, createDeleteProjectMessage(response));
}

function readRequiredProjectName(projectName: string | undefined): string {
  if (!hasText(projectName)) {
    throw new Error(missingProjectDeleteTargetMessage);
  }

  assertValidProjectName(projectName);
  return projectName;
}

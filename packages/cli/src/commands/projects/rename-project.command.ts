import type { Command } from 'commander';
import type { ProjectResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { findStoredProjectDescriptor } from '../../services/project-descriptor.service';
import type { StoredProjectDescriptor } from '../../services/project-descriptor.types';
import { renameProject } from '../../services/projects.service';
import type { RenameProjectInput } from '../../services/projects.service.types';
import type { RemoteContextInput } from '../../services/remote-context.types';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, ProjectCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import { assertValidProjectName, createRenameProjectMessage } from './project.command.helpers';

export function registerRenameProjectCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program.command('rename <name>').option('--project <name>').option('--output <format>', 'text or json', 'text'),
  ).action(
    async (nextProjectName: string, options: ProjectCommandOptions): Promise<void> =>
      await executeRenameProjectCommand(dependencies, nextProjectName, options),
  );
}

async function executeRenameProjectCommand(
  dependencies: CliCommandDependencies,
  nextProjectName: string,
  options: ProjectCommandOptions,
): Promise<void> {
  assertRenameCommandInput(nextProjectName, options.project);
  assertValidRemoteOption(options);

  const previousProjectName: string = await resolvePreviousProjectName(process.cwd(), options.project);
  const updatesLocalDescriptor: boolean = await shouldUpdateLocalDescriptor(process.cwd(), previousProjectName);
  const config: CliConfig = await readCliConfig();
  const response: ProjectResponse = await renameProject(
    await createAuthenticatedContext(config, createRenameRemoteContext(options)),
    createRenameProjectInput(nextProjectName, options),
  );

  renderOutput(
    dependencies.io,
    options.output,
    response,
    createRenameProjectMessage(previousProjectName, response, updatesLocalDescriptor),
  );
}

function createRenameRemoteContext(options: ProjectCommandOptions): RemoteContextInput {
  return {
    cwd: process.cwd(),
    remoteName: options.remote,
  };
}

function createRenameProjectInput(nextProjectName: string, options: ProjectCommandOptions): RenameProjectInput {
  return {
    cwd: process.cwd(),
    nextProjectName,
    projectName: options.project,
  };
}

function assertRenameCommandInput(nextProjectName: string, selectedProjectName?: string): void {
  assertValidProjectName(nextProjectName);
  if (selectedProjectName !== undefined) {
    assertValidProjectName(selectedProjectName);
  }
}

async function resolvePreviousProjectName(cwd: string, selectedProjectName?: string): Promise<string> {
  const descriptor: StoredProjectDescriptor | undefined = await findStoredProjectDescriptor(cwd);
  return selectedProjectName ?? descriptor?.descriptor.name ?? '';
}

async function shouldUpdateLocalDescriptor(cwd: string, previousProjectName: string): Promise<boolean> {
  const descriptor: StoredProjectDescriptor | undefined = await findStoredProjectDescriptor(cwd);
  return descriptor?.descriptor.name === previousProjectName;
}

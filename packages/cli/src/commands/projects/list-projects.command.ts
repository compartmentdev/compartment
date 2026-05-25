import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { listProjects } from '../../services/projects.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, ProjectListCommandOptions } from '../command.types';
import type { ProjectOverviewListResponse, ProjectSummaryListResponse } from '@compartment/contracts';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import {
  addListPaginationOptions,
  readListCommandPagination,
  type ResolvedListCommandPagination,
} from '../list-pagination.command';
import { createProjectListMessage } from './project.command.helpers';

export function registerListProjectsCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = program
    .command('list')
    .option('--all', 'include archived projects')
    .option('--full', 'include lifecycle, route URL, service count, and status fields')
    .option('--output <format>', 'text or json', 'text');

  addRemoteOption(addListPaginationOptions(command)).action(
    async (options: ProjectListCommandOptions): Promise<void> =>
      await executeListProjectsCommand(dependencies, options),
  );
}

async function executeListProjectsCommand(
  dependencies: CliCommandDependencies,
  options: ProjectListCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const pagination: ResolvedListCommandPagination = readListCommandPagination(options);
  const response: ProjectOverviewListResponse | ProjectSummaryListResponse = await listProjects(
    await createAuthenticatedContext(config, {
      cwd: process.cwd(),
      remoteName: options.remote,
    }),
    {
      includeArchived: options.all === true,
      includeOverview: options.full === true,
      page: pagination.page,
      perPage: pagination.perPage,
    },
  );

  renderOutput(dependencies.io, options.output, response, createProjectListMessage(response, options.all === true));
}

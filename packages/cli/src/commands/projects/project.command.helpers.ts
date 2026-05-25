import {
  type ProjectDeleteResponse,
  type ProjectLifecycleResponse,
  type ProjectOverviewListResponse,
  type ProjectOverviewSummary,
  type ProjectResponse,
  type ProjectSummary,
  type ProjectSummaryListResponse,
  type ProjectShowResponse,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { assertValidProjectName } from '../../services/project-name.service';
import type { CliCommandDependencies, ProjectCommandOptions } from '../command.types';
import type { AuthenticatedContext } from '../../services/context.types';
import { createPaginationHint } from '../list-pagination.command';
import { addRemoteOption, assertValidRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export { assertValidProjectName };

type ProjectListItem = ProjectOverviewSummary | ProjectSummary;
type CliProjectListResponse = ProjectOverviewListResponse | ProjectSummaryListResponse;

interface ProjectScopedCommandRegistration<TResponse, TOptions extends ProjectCommandOptions> {
  commandName: string;
  configureCommand?: (command: Command) => Command;
  createMessage(response: TResponse): string;
  execute(context: AuthenticatedContext, options: TOptions): Promise<TResponse>;
  validateOptions?(options: TOptions): Promise<void> | void;
}

export function registerProjectScopedCommand<TResponse, TOptions extends ProjectCommandOptions = ProjectCommandOptions>(
  program: Command,
  dependencies: CliCommandDependencies,
  registration: ProjectScopedCommandRegistration<TResponse, TOptions>,
): void {
  const command: Command = program
    .command(registration.commandName)
    .option('--project <name>')
    .option('--output <format>', 'text or json', 'text');

  addRemoteOption(registration.configureCommand?.(command) ?? command).action(
    async (options: TOptions): Promise<void> => {
      if (options.project !== undefined) {
        assertValidProjectName(options.project);
      }
      assertValidRemoteOption(options);
      await registration.validateOptions?.(options);
      const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
      const response: TResponse = await registration.execute(context, options);

      renderOutput(dependencies.io, options.output, response, registration.createMessage(response));
    },
  );
}

export function createProjectShowMessage(response: ProjectShowResponse): string {
  const lines: string[] = [
    `Project: ${response.localProjectName ?? response.project?.name ?? 'unknown'}`,
    `Remote state: ${response.remoteState}`,
  ];
  if (response.descriptorFile !== null) {
    lines.splice(1, 0, `Descriptor: ${response.descriptorFile}`);
  }
  if (response.project !== null) {
    lines.push(`Project id: ${response.project.id}`);
  }

  return lines.join('\n');
}

export function createProjectListMessage(response: CliProjectListResponse, includeArchived: boolean): string {
  if (response.projects.length === 0) {
    return includeArchived ? 'No projects found.' : 'No active projects found.';
  }

  const lines: string[] = response.projects.map(formatProjectListRow);
  const paginationHint: string | null = createPaginationHint({
    itemName: 'projects',
    pagination: response.pagination,
  });
  if (paginationHint !== null) {
    lines.push(paginationHint);
  }

  return lines.join('\n');
}

export function createRenameProjectMessage(
  previousProjectName: string,
  response: ProjectResponse,
  updatedLocalDescriptor: boolean,
): string {
  return updatedLocalDescriptor
    ? `Renamed project ${previousProjectName} -> ${response.project.name}. Updated compartment.yml.`
    : `Renamed project ${previousProjectName} -> ${response.project.name}.`;
}

export function createArchiveProjectMessage(response: ProjectResponse): string {
  return `Archived project ${response.project.name}.`;
}

export function createUnarchiveProjectMessage(response: ProjectResponse): string {
  return `Unarchived project ${response.project.name}.`;
}

export function createStartProjectMessage(response: ProjectLifecycleResponse): string {
  return response.state === 'running'
    ? `Project ${response.project.name} is already running in ${response.environment.name}.`
    : `Queued start for project ${response.project.name} in ${response.environment.name}.`;
}

export function createStopProjectMessage(response: ProjectLifecycleResponse): string {
  return `Stopped project ${response.project.name} in ${response.environment.name}.`;
}

export function createDeleteProjectMessage(response: ProjectDeleteResponse): string {
  return `Deleted project ${response.projectName}.`;
}

function formatProjectListRow(project: ProjectListItem): string {
  if (isProjectOverviewSummary(project)) {
    return [
      project.name,
      project.status,
      `${project.serviceCount} service${project.serviceCount === 1 ? '' : 's'}`,
      project.routeUrl ?? 'no route',
    ].join('\t');
  }

  return `${project.name}\t${project.archivedAt === null ? 'active' : 'archived'}`;
}

function isProjectOverviewSummary(project: ProjectListItem): project is ProjectOverviewSummary {
  return 'status' in project;
}

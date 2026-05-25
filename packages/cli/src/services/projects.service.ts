import type {
  ProjectDeleteResponse,
  ProjectLifecycleResponse,
  ProjectOverviewListResponse,
  ProjectReadResponse,
  ProjectResponse,
  ProjectStatusListResponse,
  ProjectSummaryListResponse,
  ProjectShowResponse,
} from '@compartment/contracts';
import {
  archiveProject as archiveProjectApi,
  deleteProject as deleteProjectApi,
  getProject as getProjectApi,
  isCompartmentRequestError,
  listProjects as listProjectsApi,
  renameProject as renameProjectApi,
  startProject as startProjectApi,
  stopProject as stopProjectApi,
  type CompartmentRequester,
  unarchiveProject as unarchiveProjectApi,
} from '@compartment/sdk';
import {
  assertCompartmentDescriptorProjectNameUpdateWritable,
  updateCompartmentDescriptorProjectName,
} from '../store/project-descriptor.store';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import type { StoredProjectDescriptor } from './project-descriptor.types';
import { resolveProjectTarget } from './project-target.service';
import type {
  ProjectLifecycleInput,
  ProjectListInput,
  ProjectScopeInput,
  RenameProjectInput,
  ResolvedProjectTarget,
} from './projects.service.types';

export async function listProjects(
  context: AuthenticatedContext,
  input: ProjectListInput,
): Promise<ProjectOverviewListResponse | ProjectSummaryListResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const response: ProjectOverviewListResponse | ProjectStatusListResponse | ProjectSummaryListResponse =
    await listProjectsApi(request, {
      archiveState: input.includeArchived ? 'all' : 'active',
      page: input.page,
      perPage: input.perPage,
      ...(input.includeOverview ? { detail: 'overview' } : {}),
    });

  if (response.detail === 'status') {
    throw new Error('Unexpected status-only project list response.');
  }

  return response;
}

export async function showProject(
  context: AuthenticatedContext,
  input: ProjectScopeInput,
): Promise<ProjectShowResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  try {
    return buildProjectShowResponse(target, await getProjectApi(request, target.projectName));
  } catch (error) {
    const projectError: Error | undefined = error instanceof Error ? error : undefined;
    if (target.updatesLocalDescriptor && target.descriptor !== undefined && isProjectNotFoundError(projectError)) {
      return buildMissingProjectShowResponse(target.descriptor);
    }

    throw error;
  }
}

export async function renameProject(
  context: AuthenticatedContext,
  input: RenameProjectInput,
): Promise<ProjectResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const localDescriptor: StoredProjectDescriptor | undefined = readLocalDescriptorUpdateTarget(target);

  await assertLocalDescriptorProjectNameUpdateWritable(localDescriptor);
  const response: ProjectResponse = await renameProjectApi(request, target.projectName, {
    name: input.nextProjectName,
  });

  await updateLocalDescriptorProjectName(localDescriptor, target.projectName, response.project.name);

  return response;
}

export async function archiveProject(
  context: AuthenticatedContext,
  input: ProjectScopeInput,
): Promise<ProjectResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  return await archiveProjectApi(request, target.projectName);
}

export async function unarchiveProject(
  context: AuthenticatedContext,
  input: ProjectScopeInput,
): Promise<ProjectResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  return await unarchiveProjectApi(request, target.projectName);
}

export async function startProject(
  context: AuthenticatedContext,
  input: ProjectLifecycleInput,
): Promise<ProjectLifecycleResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  return await startProjectApi(request, target.projectName, {
    environmentName: input.environmentName,
  });
}

export async function stopProject(
  context: AuthenticatedContext,
  input: ProjectLifecycleInput,
): Promise<ProjectLifecycleResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  return await stopProjectApi(request, target.projectName, {
    environmentName: input.environmentName,
  });
}

export async function deleteProject(
  context: AuthenticatedContext,
  projectName: string,
): Promise<ProjectDeleteResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  return await deleteProjectApi(request, projectName);
}

function readLocalDescriptorUpdateTarget(target: ResolvedProjectTarget): StoredProjectDescriptor | undefined {
  return target.updatesLocalDescriptor && target.descriptor !== undefined ? target.descriptor : undefined;
}

async function assertLocalDescriptorProjectNameUpdateWritable(
  descriptor: StoredProjectDescriptor | undefined,
): Promise<void> {
  if (descriptor === undefined) {
    return;
  }

  await assertCompartmentDescriptorProjectNameUpdateWritable(descriptor.filePath, descriptor.repositoryRoot);
}

async function updateLocalDescriptorProjectName(
  descriptor: StoredProjectDescriptor | undefined,
  currentProjectName: string,
  nextProjectName: string,
): Promise<void> {
  if (descriptor === undefined) {
    return;
  }

  await updateCompartmentDescriptorProjectName(
    descriptor.filePath,
    currentProjectName,
    nextProjectName,
    descriptor.repositoryRoot,
  );
}

function createProjectRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

function buildProjectShowResponse(target: ResolvedProjectTarget, response: ProjectReadResponse): ProjectShowResponse {
  return {
    descriptorFile:
      target.updatesLocalDescriptor && target.descriptor !== undefined ? target.descriptor.filePath : null,
    localProjectName:
      target.updatesLocalDescriptor && target.descriptor !== undefined ? target.descriptor.descriptor.name : null,
    project: response.project,
    remoteState: response.remoteState,
  };
}

function buildMissingProjectShowResponse(descriptor: StoredProjectDescriptor): ProjectShowResponse {
  return {
    descriptorFile: descriptor.filePath,
    localProjectName: descriptor.descriptor.name,
    project: null,
    remoteState: 'not_created',
  };
}

function isProjectNotFoundError(error: Error | null | undefined): boolean {
  return isCompartmentRequestError(error) && error.code === 'project_not_found';
}

import {
  projectDeleteResponseSchema,
  projectLifecycleResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  type ProjectListResponse,
} from '@compartment/contracts/browser';
import {
  buildProjectApiPath,
  buildProjectArchiveApiPath,
  buildProjectStartApiPath,
  buildProjectStopApiPath,
  buildProjectUnarchiveApiPath,
  projectsApiPathname,
} from '../../routes/projects/projects-api-paths';
import { isBrowserApiNetworkError, requestBrowserApi } from '../../lib/browser-api';

export type ProjectAction = 'archive' | 'delete' | 'start' | 'stop' | 'unarchive';

export type ProjectActionHandler = (action: ProjectAction, projectName: string, error?: Error) => Promise<void>;

type ProjectMutationRecoveryArchiveState = 'active' | 'archived' | 'all';
type ProjectMutationRecoveryPredicate = (response: ProjectListResponse) => boolean;

interface ProjectMutationRecoveryListItem {
  name: string;
}

interface ProjectMutationRecoveryNamedListResponse {
  projects: ProjectMutationRecoveryListItem[];
}

const projectMutationRecoveryAttemptCount: number = 20;
const projectMutationRecoveryDelayMs: number = 250;
const projectDeletePollAttemptCount: number = 11;
const projectDeletePollDelayStepMs: number = 2_000;

export async function runProjectAction(
  action: ProjectAction,
  projectName: string,
  organizationSlug: string,
): Promise<void> {
  const path: string = buildProjectActionApiPath(action, projectName);
  switch (action) {
    case 'delete':
      return await deleteProject(path, organizationSlug);
    case 'start':
    case 'stop':
      return await updateProjectLifecycle(path, organizationSlug);
    case 'archive':
      return await updateProjectArchive(path, organizationSlug, 'archived');
    case 'unarchive':
      return await updateProjectArchive(path, organizationSlug, 'active');
  }
}

async function deleteProject(path: string, organizationSlug: string): Promise<void> {
  const projectName: string = readProjectNameFromActionPath(path);
  try {
    await requestBrowserApi(path, projectDeleteResponseSchema, {
      currentOrganization: organizationSlug,
      method: 'DELETE',
    });
  } catch (error) {
    const caughtError: Error = error instanceof Error ? error : new Error('Project action failed.');
    if (!isBrowserApiNetworkError(caughtError)) {
      throw caughtError;
    }
  }

  await waitForProjectDeleteCompletion(projectName, organizationSlug);
}

async function updateProjectLifecycle(path: string, organizationSlug: string): Promise<void> {
  await requestBrowserApi(path, projectLifecycleResponseSchema, {
    currentOrganization: organizationSlug,
    json: {},
    method: 'POST',
  });
}

async function updateProjectArchive(
  path: string,
  organizationSlug: string,
  recoveredArchiveState: ProjectMutationRecoveryArchiveState,
): Promise<void> {
  const projectName: string = readProjectNameFromActionPath(path);
  try {
    await requestBrowserApi(path, projectResponseSchema, {
      currentOrganization: organizationSlug,
      method: 'POST',
    });
  } catch (error) {
    const caughtError: Error = error instanceof Error ? error : new Error('Project action failed.');
    if (!isBrowserApiNetworkError(caughtError)) {
      throw caughtError;
    }
    await waitForProjectArchiveRecovery(projectName, organizationSlug, recoveredArchiveState, caughtError);
  }
}

async function waitForProjectArchiveRecovery(
  projectName: string,
  organizationSlug: string,
  recoveredArchiveState: ProjectMutationRecoveryArchiveState,
  originalError: Error,
): Promise<void> {
  await waitForRecoveredProjectState(
    projectName,
    organizationSlug,
    recoveredArchiveState,
    (response: ProjectListResponse): boolean => responseHasProjectNamed(response, projectName),
    originalError,
  );
}

async function waitForProjectDeleteCompletion(projectName: string, organizationSlug: string): Promise<void> {
  for (let attempt: number = 0; attempt < projectDeletePollAttemptCount; attempt += 1) {
    const response: ProjectListResponse | null = await readProjectMutationRecoveryState(
      projectName,
      organizationSlug,
      'all',
    );
    if (response !== null && !responseHasProjectNamed(response, projectName)) {
      return;
    }
    if (attempt < projectDeletePollAttemptCount - 1) {
      await waitForProjectMutationRecoveryDelay(readProjectDeletePollDelayMs(attempt));
    }
  }

  throw new Error('Project removal is taking longer than expected. Refresh the page to check its status.');
}

async function waitForRecoveredProjectState(
  projectName: string,
  organizationSlug: string,
  archiveState: ProjectMutationRecoveryArchiveState,
  isRecovered: ProjectMutationRecoveryPredicate,
  originalError: Error,
): Promise<void> {
  for (let attempt: number = 0; attempt < projectMutationRecoveryAttemptCount; attempt += 1) {
    const response: ProjectListResponse | null = await readProjectMutationRecoveryState(
      projectName,
      organizationSlug,
      archiveState,
    );
    if (response !== null && isRecovered(response)) {
      return;
    }
    await waitForProjectMutationRecoveryDelay(projectMutationRecoveryDelayMs);
  }

  throw originalError;
}

async function readProjectMutationRecoveryState(
  projectName: string,
  organizationSlug: string,
  archiveState: ProjectMutationRecoveryArchiveState,
): Promise<ProjectListResponse | null> {
  try {
    return await requestBrowserApi<ProjectListResponse>(
      buildProjectMutationRecoveryListPath(projectName, archiveState),
      projectListResponseSchema,
      {
        currentOrganization: organizationSlug,
      },
    );
  } catch {
    return null;
  }
}

function responseHasProjectNamed(response: ProjectListResponse, projectName: string): boolean {
  if (response.detail === 'status') {
    return false;
  }

  const namedResponse: ProjectMutationRecoveryNamedListResponse = response;
  return namedResponse.projects.some(
    (project: ProjectMutationRecoveryListItem): boolean => project.name === projectName,
  );
}

function buildProjectMutationRecoveryListPath(
  projectName: string,
  archiveState: ProjectMutationRecoveryArchiveState,
): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('archiveState', archiveState);
  searchParams.set('detail', 'summary');
  searchParams.set('search', projectName);

  return `${projectsApiPathname}?${searchParams.toString()}`;
}

function readProjectDeletePollDelayMs(attempt: number): number {
  return (attempt + 1) * projectDeletePollDelayStepMs;
}

async function waitForProjectMutationRecoveryDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout((): void => resolve(), delayMs);
  });
}

function readProjectNameFromActionPath(path: string): string {
  return decodeURIComponent(path.split('/')[3] ?? '');
}

function buildProjectActionApiPath(action: ProjectAction, projectName: string): string {
  switch (action) {
    case 'archive':
      return buildProjectArchiveApiPath(projectName);
    case 'delete':
      return buildProjectApiPath(projectName);
    case 'start':
      return buildProjectStartApiPath(projectName);
    case 'stop':
      return buildProjectStopApiPath(projectName);
    case 'unarchive':
      return buildProjectUnarchiveApiPath(projectName);
  }
}

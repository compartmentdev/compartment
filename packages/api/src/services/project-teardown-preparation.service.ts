import { projectTeardownPreparationHeartbeatIntervalMs } from '../queries/project-provisioning-policy';
import { releaseProjectTeardownPreparation, renewProjectTeardownPreparation } from '../queries/project-teardown.query';
import type { ProjectRow } from '../queries/projects.query.types';
import { cleanupDeletedProjectRuntime } from './project-runtime-cleanup.service';

export async function cleanupPreparedProjectRuntime(project: ProjectRow, preparationLeaseId: string): Promise<void> {
  const heartbeatController: AbortController = new AbortController();
  const heartbeat: Promise<Error | null> = maintainPreparationLease(
    project.id,
    preparationLeaseId,
    heartbeatController.signal,
  );
  try {
    await cleanupDeletedProjectRuntime(project);
  } catch (error) {
    await stopPreparationHeartbeat(heartbeatController, heartbeat);
    await releaseProjectTeardownPreparation(project.id, preparationLeaseId);
    throw error;
  }
  const heartbeatError: Error | null = await stopPreparationHeartbeat(heartbeatController, heartbeat);
  if (heartbeatError !== null) {
    await releaseProjectTeardownPreparation(project.id, preparationLeaseId);
    throw heartbeatError;
  }
}

async function maintainPreparationLease(
  projectId: string,
  preparationLeaseId: string,
  signal: AbortSignal,
): Promise<Error | null> {
  for (;;) {
    try {
      await waitForPreparationHeartbeat(signal);
      if (!(await renewProjectTeardownPreparation(projectId, preparationLeaseId))) {
        return new Error('Project Kubernetes teardown preparation lease was lost.');
      }
    } catch {
      if (signal.aborted) {
        return null;
      }
    }
  }
}

async function waitForPreparationHeartbeat(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const abort: () => void = (): void => {
      clearTimeout(timeout);
      reject(new Error('Project Kubernetes teardown preparation heartbeat stopped.'));
    };
    const complete: () => void = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout: NodeJS.Timeout = setTimeout(complete, projectTeardownPreparationHeartbeatIntervalMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function stopPreparationHeartbeat(
  controller: AbortController,
  heartbeat: Promise<Error | null>,
): Promise<Error | null> {
  controller.abort();
  return await heartbeat;
}

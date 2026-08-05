import { setTimeout as sleep } from 'node:timers/promises';
import {
  deploymentInspectResponseSchema,
  workerClaimProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningV2Pathname,
  workerAppendDeploymentEventPathname,
  projectDeleteResponseSchema,
  projectLifecycleResponseSchema,
  projectResponseSchema,
  deploymentLogsResponseSchema,
  deploymentRunLogsResponseSchema,
  resourceListResponseSchema,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentInspectResponse,
  type DeploymentReadSummary,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentStatusResponse,
  type ProjectDeleteResponse,
  type ProjectLifecycleResponse,
  type ProjectResponse,
  type ResourceListResponse,
  type ResourceSummary,
} from '@compartment/contracts';
import { expect } from 'vitest';
import { sendCliHttpTextRequest, type CliHttpTextResponse } from './cli-http-test.harness';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import type { SelfHostedUserSetupCommandResult } from './self-hosted-user-setup-command.harness';
import {
  deploymentStatusCommandResponseParser,
  requireDeploymentRuntimeImageRef,
  requireSingleInspectedActiveDeployment,
} from './self-hosted-user-setup-cli-response.harness';
import { expectK3dProjectNamespaceDeleted, seedK3dProjectTeardownFixture } from './self-hosted-user-setup-k3d.harness';

const deploymentRunPollDelayMs: number = 2_000;
const deploymentRunPollAttempts: number = process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1' ? 900 : 90;
const deploymentBuildLifecycleTimeoutMs: number = 30 * 60_000;
const deploymentRunFailurePropagationGraceMs: number = 2 * 60_000;
export const deploymentRunCompletionTimeoutMs: number =
  deploymentBuildLifecycleTimeoutMs + deploymentRunFailurePropagationGraceMs;
const kubernetesResourceStartupTimeoutMs: number = 180_000;
const blockedPublicControlPlanePollAttempts: number = 6;
const blockedPublicControlPlanePollDelayMs: number = 1_000;
const detachedDeploymentRunPattern: RegExp = /Run:\s+([A-Za-z0-9_]+)/u;
const archivedProjectMessage: string = 'The requested project is archived.';
const missingProjectMessage: string = 'The requested project was not found.';
const blockedPublicControlPlaneRequests: readonly BlockedPublicControlPlaneRequest[] = [
  { pathname: '/internal/app-access/state' },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: '/internal/nodes/register',
  },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: workerClaimProjectProvisioningV2Pathname,
  },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: workerCompleteProjectProvisioningV2Pathname,
  },
  { pathname: '/healthz' },
  { pathname: '/readyz' },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: '/internal/deployments/runtime-state',
  },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: workerAppendDeploymentEventPathname,
  },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: '/internal/deployments/recover-running?mode=invalid',
  },
];

interface BlockedPublicControlPlaneRequest {
  readonly body?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly method?: string | undefined;
  readonly pathname: string;
}

interface StoppedDeploymentCandidate {
  readonly serviceName: string;
  readonly status: string;
}

export async function expectBlockedPublicControlPlanePaths(compartmentUrl: string): Promise<void> {
  for (const request of blockedPublicControlPlaneRequests) {
    await expectBlockedPublicControlPlanePath(compartmentUrl, request);
  }
}

async function expectBlockedPublicControlPlanePath(
  compartmentUrl: string,
  request: BlockedPublicControlPlaneRequest,
): Promise<void> {
  let lastError: Error | null = null;
  let lastStatusCode: number | null = null;

  for (let attempt: number = 0; attempt < blockedPublicControlPlanePollAttempts; attempt += 1) {
    try {
      const response: CliHttpTextResponse = await sendCliHttpTextRequest(
        new URL(request.pathname, compartmentUrl).toString(),
        {
          body: request.body,
          headers: request.headers,
          method: request.method,
        },
      );

      if (response.statusCode === 404) {
        return;
      }
      lastStatusCode = response.statusCode;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await sleep(blockedPublicControlPlanePollDelayMs);
  }

  if (lastStatusCode !== null) {
    expect(lastStatusCode).toBe(404);
  }
  throw new Error(
    `Timed out waiting for public control-plane path ${request.pathname} at ${compartmentUrl} to return 404. Last error: ${
      lastError?.message ?? 'none'
    }`,
  );
}

export function requireDetachedDeploymentRunId(stdout: string): string {
  const match: RegExpExecArray | null = detachedDeploymentRunPattern.exec(stdout);
  if (match?.[1] === undefined) {
    throw new Error(`Expected detached deploy stdout to include a deployment run id. stdout: ${stdout}`);
  }

  return match[1];
}

export async function waitForDeploymentRunCompletion(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  deploymentRunId: string,
): Promise<DeploymentRunLogsResponse> {
  const deadline: number = Date.now() + deploymentRunCompletionTimeoutMs;
  let lastPayload: DeploymentRunLogsResponse | null = null;
  do {
    const payload: DeploymentRunLogsResponse = await cli.runJson(
      `deployment logs --project ${projectName} --run ${deploymentRunId}`,
      deploymentRunLogsResponseSchema,
    );
    const completedStep: DeploymentRunStepSummary | undefined = payload.steps.find(
      (step: DeploymentRunStepSummary): boolean => step.stepKey === 'completed',
    );
    if (completedStep?.status === 'succeeded') {
      return payload;
    }
    if (payload.deployment.status === 'failed' || completedStep?.status === 'failed') {
      throw new Error(`Deployment run ${deploymentRunId} failed.`);
    }
    if (payload.deployment.status === 'stopped') {
      throw new Error(`Deployment run ${deploymentRunId} stopped.`);
    }

    lastPayload = payload;
    await sleep(deploymentRunPollDelayMs);
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for deployment run ${deploymentRunId}. Last payload: ${JSON.stringify(lastPayload)}`,
  );
}

export async function waitForDeploymentRuntimeLog(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  serviceName: string,
  expectedMessage: string,
): Promise<DeploymentLogsResponse> {
  let lastPayload: DeploymentLogsResponse | null = null;
  for (let attempt: number = 0; attempt < deploymentRunPollAttempts; attempt += 1) {
    const payload: DeploymentLogsResponse = await cli.runJson(
      `logs --project ${projectName}`,
      deploymentLogsResponseSchema,
    );
    if (
      payload.lines.some(
        (line: DeploymentLogLine): boolean =>
          line.serviceName === serviceName && line.message.includes(expectedMessage),
      )
    ) {
      return payload;
    }
    lastPayload = payload;
    await sleep(deploymentRunPollDelayMs);
  }

  throw new Error(
    `Timed out waiting for runtime log from ${projectName}/${serviceName}. Last payload: ${JSON.stringify(lastPayload)}`,
  );
}

export async function waitForRunningResource(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  expectedResourceName: string,
): Promise<void> {
  const deadline: number = Date.now() + kubernetesResourceStartupTimeoutMs;
  do {
    const list: ResourceListResponse = await cli.runJson(
      `resource list --project ${projectName}`,
      resourceListResponseSchema,
    );
    if (
      list.resources.some(
        (resource: ResourceSummary): boolean => resource.name === expectedResourceName && resource.status === 'running',
      )
    ) {
      return;
    }
    await sleep(deploymentRunPollDelayMs);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for Kubernetes resource ${expectedResourceName} to become running.`);
}

export async function waitForDeploymentRuntimeImageRef(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  serviceName: string,
  expectedImageRef: string,
): Promise<string> {
  requireCanonicalRuntimeImageRef(expectedImageRef);

  const deadline: number = Date.now() + kubernetesResourceStartupTimeoutMs;
  let lastImageRef: string | null = null;
  for (;;) {
    const remainingTimeoutMs: number = deadline - Date.now();
    if (remainingTimeoutMs <= 0) {
      break;
    }
    let inspect: DeploymentInspectResponse;
    try {
      inspect = await cli.runJson(`inspect --project ${projectName}`, deploymentInspectResponseSchema, {
        timeoutMs: remainingTimeoutMs,
      });
    } catch (error) {
      if (Date.now() < deadline) {
        throw error;
      }
      const cause: Error = error instanceof Error ? error : new Error(String(error));
      throw buildRuntimeImageRefTimeoutError(projectName, serviceName, expectedImageRef, lastImageRef, cause);
    }
    lastImageRef = requireDeploymentRuntimeImageRef(requireSingleInspectedActiveDeployment(inspect, serviceName));
    if (lastImageRef === expectedImageRef) {
      return lastImageRef;
    }
    const remainingDelayMs: number = deadline - Date.now();
    if (remainingDelayMs > 0) {
      await sleep(Math.min(deploymentRunPollDelayMs, remainingDelayMs));
    }
  }

  throw buildRuntimeImageRefTimeoutError(projectName, serviceName, expectedImageRef, lastImageRef);
}

function requireCanonicalRuntimeImageRef(imageRef: string): void {
  if (!/^[^@]+@sha256:[a-f0-9]{64}$/u.test(imageRef)) {
    throw new Error(`Expected a canonical digest-pinned rollback image ref, received ${imageRef}.`);
  }
}

function buildRuntimeImageRefTimeoutError(
  projectName: string,
  serviceName: string,
  expectedImageRef: string,
  lastImageRef: string | null,
  cause?: Error,
): Error {
  return new Error(
    `Timed out waiting for ${projectName}/${serviceName} to expose rollback image ${expectedImageRef}. Last observed image: ${lastImageRef ?? 'none'}.`,
    { cause },
  );
}

async function waitForSingleActiveDeployment(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  serviceName: string,
): Promise<DeploymentReadSummary> {
  let lastPayload: DeploymentStatusResponse | null = null;
  for (let attempt: number = 0; attempt < deploymentRunPollAttempts; attempt += 1) {
    const payload: DeploymentStatusResponse = await cli.runJson(
      `status --project ${projectName}`,
      deploymentStatusCommandResponseParser,
    );
    const deployments: DeploymentReadSummary[] = payload.activeDeployments.filter(
      (candidate: DeploymentReadSummary): boolean => candidate.serviceName === serviceName,
    );
    if (deployments.length > 1) {
      throw new Error(
        `Expected one active deployment for ${projectName}/${serviceName}. Payload: ${JSON.stringify(payload)}`,
      );
    }

    const deployment: DeploymentReadSummary | undefined = deployments[0];
    if (deployment?.status === 'succeeded') {
      return deployment;
    }
    if (deployment?.status === 'failed') {
      throw new Error(`Deployment for ${projectName}/${serviceName} failed.`);
    }

    lastPayload = payload;
    await sleep(deploymentRunPollDelayMs);
  }

  throw new Error(
    `Timed out waiting for active deployment for ${projectName}/${serviceName}. Last payload: ${JSON.stringify(
      lastPayload,
    )}`,
  );
}

export async function expectExplicitProjectLifecycleFlow(
  cli: SelfHostedUserSetupCli,
  projectId: string,
  projectName: string,
  serviceName: string,
  expectedRouteUrl: string,
): Promise<void> {
  const stoppedProject: ProjectLifecycleResponse = await cli.runJson(
    `project stop --project ${projectName}`,
    projectLifecycleResponseSchema,
  );
  expect(stoppedProject.action).toBe('stop');
  expect(stoppedProject.state).toBe('stopped');
  expect(stoppedProject.deployments.some(isStoppedDeployment(serviceName))).toBe(true);

  const stoppedStatus: DeploymentStatusResponse = await cli.runJson(
    `status --project ${projectName}`,
    deploymentStatusCommandResponseParser,
  );
  expect(stoppedStatus.activeDeployments).toEqual([]);
  expect(stoppedStatus.deployments.some(isStoppedDeployment(serviceName))).toBe(true);

  const repeatedStop: ProjectLifecycleResponse = await cli.runJson(
    `project stop --project ${projectName}`,
    projectLifecycleResponseSchema,
  );
  expect(repeatedStop.action).toBe('stop');
  expect(repeatedStop.state).toBe('stopped');

  const startedProject: ProjectLifecycleResponse = await cli.runJson(
    `project start --project ${projectName}`,
    projectLifecycleResponseSchema,
  );
  expect(startedProject.action).toBe('start');
  expect(startedProject.state).toBe('updating');
  const restartedDeployment: DeploymentReadSummary = await waitForSingleActiveDeployment(cli, projectName, serviceName);
  expect(restartedDeployment.routeUrl).toBe(expectedRouteUrl);

  const archivedProject: ProjectResponse = await cli.runJson(
    `project archive --project ${projectName} --yes`,
    projectResponseSchema,
  );
  expect(archivedProject.project.archivedAt).not.toBeNull();

  const archivedStatus: SelfHostedUserSetupCommandResult = await cli.runFailure(
    `status --project ${projectName} --output json`,
  );
  expect(archivedStatus.stderr).toContain(archivedProjectMessage);

  await seedK3dProjectTeardownFixture(projectId);

  const deletedProject: ProjectDeleteResponse = await cli.runJson(
    `project delete --project ${projectName} --yes`,
    projectDeleteResponseSchema,
  );
  expect(deletedProject.projectName).toBe(projectName);
  const deletedStatus: SelfHostedUserSetupCommandResult = await waitForProjectDeletionTerminalState(cli, projectName);
  expect(deletedStatus.stderr).toContain(missingProjectMessage);
  await expectK3dProjectNamespaceDeleted(projectId);
}

async function waitForProjectDeletionTerminalState(
  cli: SelfHostedUserSetupCli,
  projectName: string,
): Promise<SelfHostedUserSetupCommandResult> {
  let lastResult: SelfHostedUserSetupCommandResult | null = null;
  for (let attempt: number = 0; attempt < deploymentRunPollAttempts; attempt += 1) {
    lastResult = await cli.runFailure(`status --project ${projectName} --output json`);
    if (lastResult.stderr.includes(missingProjectMessage)) {
      return lastResult;
    }
    if (!lastResult.stderr.includes(archivedProjectMessage)) {
      throw new Error(
        `Unexpected project status while waiting for ${projectName} deletion. Exit code: ${lastResult.exitCode}. ` +
          `Stdout: ${JSON.stringify(lastResult.stdout)}. Stderr: ${JSON.stringify(lastResult.stderr)}.`,
      );
    }
    await sleep(deploymentRunPollDelayMs);
  }
  throw new Error(
    `Timed out waiting for project ${projectName} deletion to reach the not-found terminal state after ${
      deploymentRunPollAttempts * deploymentRunPollDelayMs
    }ms. Last exit code: ${lastResult?.exitCode ?? 'unavailable'}. Last stdout: ${JSON.stringify(
      lastResult?.stdout ?? '',
    )}. Last stderr: ${JSON.stringify(lastResult?.stderr ?? '')}.`,
  );
}

function isStoppedDeployment(serviceName: string): (deployment: StoppedDeploymentCandidate) => boolean {
  return (deployment: StoppedDeploymentCandidate): boolean =>
    deployment.serviceName === serviceName && deployment.status === 'stopped';
}

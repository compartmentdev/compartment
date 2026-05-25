import { setTimeout as sleep } from 'node:timers/promises';
import {
  compartmentInternalNodeRegistrationPathname,
  projectDeleteResponseSchema,
  projectLifecycleResponseSchema,
  projectResponseSchema,
  deploymentStatusResponseSchema,
  deploymentRunLogsResponseSchema,
  type DeploymentReadSummary,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentStatusResponse,
  type ProjectDeleteResponse,
  type ProjectLifecycleResponse,
  type ProjectResponse,
} from '@compartment/contracts';
import { expect } from 'vitest';
import { sendCliHttpTextRequest, type CliHttpTextResponse } from './cli-http-test.harness';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import type { SelfHostedUserSetupCommandResult } from './self-hosted-user-setup-command.harness';

const deploymentRunPollAttempts: number = 90;
const deploymentRunPollDelayMs: number = 2_000;
const detachedDeploymentRunPattern: RegExp = /Run:\s+([A-Za-z0-9_]+)/u;
const archivedProjectMessage: string = 'The requested project is archived.';
const missingProjectMessage: string = 'The requested project was not found.';
const blockedPublicControlPlaneRequests: readonly BlockedPublicControlPlaneRequest[] = [
  { pathname: '/internal/app-access/state' },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: compartmentInternalNodeRegistrationPathname,
  },
  { pathname: '/healthz' },
  { pathname: '/readyz' },
  {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    pathname: '/v1/nodes/register',
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
    const response: CliHttpTextResponse = await sendCliHttpTextRequest(
      new URL(request.pathname, compartmentUrl).toString(),
      {
        body: request.body,
        headers: request.headers,
        method: request.method,
      },
    );

    expect(response.statusCode).toBe(404);
  }
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
  let lastPayload: DeploymentRunLogsResponse | null = null;
  for (let attempt: number = 0; attempt < deploymentRunPollAttempts; attempt += 1) {
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
    if (completedStep?.status === 'failed') {
      throw new Error(`Deployment run ${deploymentRunId} failed.`);
    }

    lastPayload = payload;
    await sleep(deploymentRunPollDelayMs);
  }

  throw new Error(
    `Timed out waiting for deployment run ${deploymentRunId}. Last payload: ${JSON.stringify(lastPayload)}`,
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
      deploymentStatusResponseSchema,
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
    deploymentStatusResponseSchema,
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

  const deletedProject: ProjectDeleteResponse = await cli.runJson(
    `project delete --project ${projectName} --yes`,
    projectDeleteResponseSchema,
  );
  expect(deletedProject.projectName).toBe(projectName);

  const deletedStatus: SelfHostedUserSetupCommandResult = await cli.runFailure(
    `status --project ${projectName} --output json`,
  );
  expect(deletedStatus.stderr).toContain(missingProjectMessage);
}

function isStoppedDeployment(serviceName: string): (deployment: StoppedDeploymentCandidate) => boolean {
  return (deployment: StoppedDeploymentCandidate): boolean =>
    deployment.serviceName === serviceName && deployment.status === 'stopped';
}

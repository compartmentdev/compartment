import type { DeploymentRunLogsResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  deploymentRunCompletionTimeoutMs,
  waitForDeploymentRunCompletion,
} from './self-hosted-user-setup-deployment-flow.harness';

describe('deployment run completion wait', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('allows a progressing image build to finish after the former three-minute observer limit', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T09:42:46.000Z'));
    const cli: SelfHostedUserSetupCli = new SelfHostedUserSetupCli({}, 1_000);
    const runningPayload: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse('running');
    const succeededPayload: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse('succeeded');
    const startedAtMs: number = Date.now();
    vi.spyOn(cli, 'runJson').mockImplementation(
      async (): Promise<never> =>
        await Promise.resolve((Date.now() - startedAtMs > 180_000 ? succeededPayload : runningPayload) as never),
    );

    const completion: Promise<DeploymentRunLogsResponse> = waitForDeploymentRunCompletion(
      cli,
      'slow-build',
      'drn_slow',
    );
    await vi.advanceTimersByTimeAsync(182_000);

    await expect(completion).resolves.toBe(succeededPayload);
    expect(Date.now() - startedAtMs).toBeGreaterThan(180_000);
  });

  it('fails immediately with lifecycle diagnostics when the deployment becomes terminal', async (): Promise<void> => {
    const cli: SelfHostedUserSetupCli = new SelfHostedUserSetupCli({}, 1_000);
    const failedPayload: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse('deployment_failed');
    vi.spyOn(cli, 'runJson').mockResolvedValue(failedPayload);

    const failure: Error = await readWaitError(waitForDeploymentRunCompletion(cli, 'failed-build', 'drn_failed'));

    expect(failure.message).toContain('Deployment run drn_failed failed.');
    expect(failure.message).toContain('Status: failed.');
    expect(failure.message).toContain('Failure message: Build sandbox exceeded its deadline.');
    expect(failure.message).toContain('building_image:running:Building image.');
    expect(failure.message).toContain('Last observed timestamp: 2026-08-04T09:46:00.000Z.');
    expect(failure.message).toContain('Last payload:');
  });

  it('fails immediately with lifecycle diagnostics when the deployment is stopped', async (): Promise<void> => {
    const cli: SelfHostedUserSetupCli = new SelfHostedUserSetupCli({}, 1_000);
    const stoppedPayload: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse('stopped');
    vi.spyOn(cli, 'runJson').mockResolvedValue(stoppedPayload);

    const failure: Error = await readWaitError(waitForDeploymentRunCompletion(cli, 'stopped-build', 'drn_stopped'));

    expect(failure.message).toContain('Deployment run drn_stopped stopped.');
    expect(failure.message).toContain('Status: stopped.');
    expect(failure.message).toContain('building_image:running:Building image.');
    expect(failure.message).toContain('Last payload:');
  });

  it('bounds the observer and reports the last known progress for a running deployment', async (): Promise<void> => {
    vi.useFakeTimers();
    const cli: SelfHostedUserSetupCli = new SelfHostedUserSetupCli({}, 1_000);
    const runningPayload: DeploymentRunLogsResponse = buildDeploymentRunLogsResponse('running');
    vi.spyOn(cli, 'runJson').mockResolvedValue(runningPayload);

    const completion: Promise<DeploymentRunLogsResponse> = waitForDeploymentRunCompletion(
      cli,
      'stalled-build',
      'drn_running',
    );
    await vi.advanceTimersByTimeAsync(deploymentRunCompletionTimeoutMs);
    const failure: Error = await readWaitError(completion);

    expect(failure.message).toContain('Deployment run drn_running timed out.');
    expect(failure.message).toContain('Status: running.');
    expect(failure.message).toContain('Failure message: none.');
    expect(failure.message).toContain('building_image:running:Building image.');
    expect(failure.message).toContain('Last observed timestamp: 2026-08-04T09:46:00.000Z.');
    expect(failure.message).toContain('Last payload:');
  });
});

function buildDeploymentRunLogsResponse(
  state: 'deployment_failed' | 'running' | 'stopped' | 'succeeded',
): DeploymentRunLogsResponse {
  const status: 'running' | 'succeeded' = state === 'succeeded' ? 'succeeded' : 'running';
  const succeeded: boolean = status === 'succeeded';
  const failed: boolean = state === 'deployment_failed';
  const stopped: boolean = state === 'stopped';
  let deploymentId: string = 'drn_running';
  let deploymentStatus: 'failed' | 'running' | 'stopped' | 'succeeded' = 'running';
  let completedMessage: string = 'Deployment pending.';
  if (succeeded) {
    deploymentId = 'drn_slow';
    deploymentStatus = 'succeeded';
    completedMessage = 'Deployment completed.';
  } else if (failed) {
    deploymentId = 'drn_failed';
    deploymentStatus = 'failed';
    completedMessage = 'Deployment failed.';
  } else if (stopped) {
    deploymentId = 'drn_stopped';
    deploymentStatus = 'stopped';
    completedMessage = 'Deployment stopped.';
  }
  return {
    deployment: {
      completedAt: succeeded || failed ? '2026-08-04T09:46:01.000Z' : null,
      createdAt: '2026-08-04T09:42:46.000Z',
      failureMessage: failed ? 'Build sandbox exceeded its deadline.' : null,
      id: deploymentId,
      label: null,
      status: deploymentStatus,
      trigger: {
        branchName: null,
        commitSha: null,
        repositoryName: null,
        repositoryOwner: null,
        sourceEventId: null,
        sourceResolutionTaskId: null,
        type: 'manual',
      },
    },
    deployments: [],
    environment: { name: 'production' },
    lines: [
      {
        deploymentId: null,
        level: 'info',
        message: 'BuildKit is exporting the image.',
        serviceName: 'web',
        stepKey: 'building_image',
        stream: 'stdout',
        timestamp: '2026-08-04T09:46:00.000Z',
      },
    ],
    project: { name: 'slow-build' },
    steps: [
      {
        completedAt: null,
        createdAt: '2026-08-04T09:42:47.000Z',
        deploymentId: null,
        message: 'Building image.',
        serviceName: 'web',
        status: 'running',
        stepKey: 'building_image',
      },
      {
        completedAt: succeeded ? '2026-08-04T09:46:01.000Z' : null,
        createdAt: '2026-08-04T09:42:46.000Z',
        deploymentId: null,
        message: completedMessage,
        serviceName: null,
        status,
        stepKey: 'completed',
      },
    ],
  };
}

async function readWaitError(wait: Promise<DeploymentRunLogsResponse>): Promise<Error> {
  try {
    await wait;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected deployment run wait to fail.');
}

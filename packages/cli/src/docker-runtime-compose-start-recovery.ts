import { setTimeout as sleep } from 'node:timers/promises';
import type { SystemServiceName } from '@compartment/contracts';
import type { CommandResult } from './command-runner.types';
import { areSelfHostedRuntimeServicesAvailable } from './docker-runtime-availability';
import type { DockerExecutionContext, StartSelfHostedRuntimeInput } from './docker-runtime.types';

const composeStartRecoveryTimeoutMs: number = 30_000;
const composeStartRecoveryPollIntervalMs: number = 1_000;

export async function recoverAvailableSelfHostedRuntimeServicesAfterComposeStartError(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  upResult: CommandResult,
  services: readonly SystemServiceName[],
  recoveryMessage: string,
): Promise<boolean> {
  if (!isComposeTransientMissingContainerError(upResult)) {
    return false;
  }
  if (!(await waitForSelfHostedRuntimeServicesAvailable(context, input, services))) {
    return false;
  }

  input.reportProgress?.(recoveryMessage);
  return true;
}

async function waitForSelfHostedRuntimeServicesAvailable(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  services: readonly SystemServiceName[],
): Promise<boolean> {
  const deadline: number = Date.now() + composeStartRecoveryTimeoutMs;

  while (Date.now() <= deadline) {
    if (await areRuntimeServicesAvailable(context, input, services)) {
      return true;
    }
    await sleep(composeStartRecoveryPollIntervalMs);
  }

  return false;
}

async function areRuntimeServicesAvailable(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  services: readonly SystemServiceName[],
): Promise<boolean> {
  try {
    return await areSelfHostedRuntimeServicesAvailable(context, input, services);
  } catch {
    return false;
  }
}

function isComposeTransientMissingContainerError(result: CommandResult): boolean {
  return result.stderr.includes('No such container') || result.stdout.includes('No such container');
}

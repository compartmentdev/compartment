import { readCommandOutput, runCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import { readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import type { SelfHostedRuntimeIdentity } from './self-hosted-runtime-identity.types';
import { runRequiredSelfHostedSystemCommand } from './self-hosted-system-command';

export const defaultSelfHostedRuntimeUid: number = 10001;
export const defaultSelfHostedRuntimeGid: number = 10001;
export const selfHostedRuntimeGroupName: string = 'compartment-runtime';
export type { SelfHostedRuntimeIdentity } from './self-hosted-runtime-identity.types';

interface SystemGroupEntry {
  readonly gid: number;
  readonly name: string;
}

export function readSelfHostedRuntimeIdentity(values: Record<string, string>): SelfHostedRuntimeIdentity {
  return {
    uid: readRequiredFixedRuntimeIdentityValue(values, 'COMPARTMENT_RUNTIME_UID', defaultSelfHostedRuntimeUid),
    gid: readRequiredFixedRuntimeIdentityValue(values, 'COMPARTMENT_RUNTIME_GID', defaultSelfHostedRuntimeGid),
  };
}

export async function ensureSelfHostedRuntimeGroup(identity: SelfHostedRuntimeIdentity): Promise<void> {
  const groupByName: SystemGroupEntry | null = await readSystemGroupByName(selfHostedRuntimeGroupName);
  if (groupByName !== null) {
    if (groupByName.gid !== identity.gid) {
      throw new Error(
        `Host group ${selfHostedRuntimeGroupName} has GID ${groupByName.gid.toString()}; expected ${identity.gid.toString()}.`,
      );
    }
    return;
  }

  const groupByGid: SystemGroupEntry | null = await readSystemGroupByGid(identity.gid);
  if (groupByGid !== null) {
    throw new Error(
      `Host GID ${identity.gid.toString()} is already assigned to group ${groupByGid.name}; expected ${selfHostedRuntimeGroupName}.`,
    );
  }

  await runRequiredSelfHostedSystemCommand(
    ['groupadd', '--system', '--gid', String(identity.gid), selfHostedRuntimeGroupName],
    `Failed to create host group ${selfHostedRuntimeGroupName} with GID ${identity.gid.toString()}.`,
  );
}

function readRequiredFixedRuntimeIdentityValue(
  values: Record<string, string>,
  variableName: string,
  expectedValue: number,
): number {
  const rawValue: string = readRequiredSelfHostedEnvironmentValue(values, variableName);
  if (/^[1-9]\d*$/u.test(rawValue)) {
    const parsedValue: number = Number(rawValue);
    if (Number.isSafeInteger(parsedValue) && parsedValue === expectedValue) {
      return parsedValue;
    }
  }

  throw new Error(
    `The self-hosted environment has an invalid ${variableName} value: ${rawValue}. Expected ${expectedValue.toString()}.`,
  );
}

async function readSystemGroupByName(name: string): Promise<SystemGroupEntry | null> {
  return await readSystemGroup(['getent', 'group', name], `Failed to inspect host group ${name}.`);
}

async function readSystemGroupByGid(gid: number): Promise<SystemGroupEntry | null> {
  return await readSystemGroup(['getent', 'group', String(gid)], `Failed to inspect host group GID ${gid.toString()}.`);
}

async function readSystemGroup(command: readonly string[], failureMessage: string): Promise<SystemGroupEntry | null> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode === 2) {
    return null;
  }
  if (result.exitCode !== 0) {
    throw new Error(`${failureMessage}\n${readCommandOutput(result)}`);
  }
  if (result.stdout.trim() === '') {
    return null;
  }

  return parseSystemGroupEntry(result.stdout.trim().split('\n')[0]!);
}

function parseSystemGroupEntry(line: string): SystemGroupEntry {
  const parts: string[] = line.split(':');
  const name: string | undefined = parts[0];
  const rawGid: string | undefined = parts[2];
  if (name === undefined || rawGid === undefined || !/^\d+$/u.test(rawGid)) {
    throw new Error(`Failed to parse host group entry: ${line}.`);
  }

  return {
    gid: Number(rawGid),
    name,
  };
}

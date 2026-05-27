import {
  ensureDockerImageAvailable,
  removeDockerContainer,
  runDockerContainerToCompletion,
  type DockerLogLine,
  type DockerRunContainerInput,
  type DockerRunContainerToCompletionResult,
} from '@compartment/docker';
import type { NodeReleaseLogLine, NodeReleaseRequest, NodeReleaseResponse } from '@compartment/contracts';
import { buildReleaseContainerLabels } from './runtime-container-labels';
import { buildRuntimeEnv, resolveRuntimeContainerPort } from './runtime-env.service';
import { ensureOwnedRuntimeNetwork } from './runtime-network-ownership.service';
import { buildDeploymentReleaseContainerName, buildRuntimeResourceNetworkName } from './runtime-names.service';
import { buildRuntimeShellCommandContainerInvocation } from './runtime-shell-command.service';
import type { RuntimeDeployConfig } from './runtime.types';

const defaultRuntimeReleaseTimeoutMs: number = 600_000;

interface DockerOperationError {
  logs?: DockerLogLine[] | undefined;
  stderr?: string | undefined;
  stdout?: string | undefined;
}

type RuntimeReleaseErrorInput =
  | Error
  | DockerOperationError
  | string
  | number
  | boolean
  | symbol
  | bigint
  | null
  | undefined;

export async function releaseRuntimeContainer(
  input: NodeReleaseRequest,
  config: RuntimeDeployConfig,
): Promise<NodeReleaseResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.imageRef,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  const containerPort: number = await resolveRuntimeContainerPort(input.imageRef, input.runtimeEnv);
  const containerName: string = buildDeploymentReleaseContainerName(input, config.dockerNamespace);
  const networkName: string = buildRuntimeResourceNetworkName(input, config.dockerNamespace);
  await ensureOwnedRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName });
  await removeDockerContainer({ containerRef: containerName });

  try {
    const result: DockerRunContainerToCompletionResult = await runDockerContainerToCompletion(
      buildReleaseContainerInput(input, config, containerPort, containerName, networkName),
    );

    return buildRuntimeReleaseResponse(result);
  } catch (error) {
    throw buildRuntimeReleaseError(error as RuntimeReleaseErrorInput);
  }
}

function buildRuntimeReleaseResponse(result: DockerRunContainerToCompletionResult): NodeReleaseResponse {
  return {
    completedAt: new Date().toISOString(),
    logs: result.logs.map(formatRuntimeReleaseLogLine),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function formatRuntimeReleaseLogLine(line: DockerLogLine): NodeReleaseLogLine {
  return {
    message: line.message,
    stream: line.stream,
  };
}

function buildReleaseContainerInput(
  input: NodeReleaseRequest,
  config: RuntimeDeployConfig,
  containerPort: number,
  containerName: string,
  networkName: string,
): DockerRunContainerInput {
  return {
    ...buildRuntimeShellCommandContainerInvocation(input.release.command),
    containerName,
    env: buildRuntimeEnv(input.runtimeEnv, containerPort),
    imageRef: input.imageRef,
    labels: buildReleaseContainerLabels(config.dockerNamespace, input),
    network: {
      aliases: [],
      name: networkName,
    },
    securityProfile: {
      name: 'restricted-writable',
      writableRootFilesystemReason: 'User release commands can require writable runtime paths.',
    },
    timeoutMs: defaultRuntimeReleaseTimeoutMs,
  };
}

function buildRuntimeReleaseError(error: RuntimeReleaseErrorInput): Error {
  const detail: string = error instanceof Error ? error.message : 'Unexpected release command error.';
  const logs: string = readDockerOperationErrorLogs(error);

  return new Error(
    logs === '' ? `release command failed: ${detail}` : `release command failed: ${detail}\nLast logs:\n${logs}`,
  );
}

function readDockerOperationErrorLogs(error: RuntimeReleaseErrorInput): string {
  if (!isDockerOperationError(error)) {
    return '';
  }

  if (error.logs !== undefined && error.logs.length > 0) {
    return renderDockerOperationOutput(error.logs.map(formatDockerOperationLogLine));
  }

  return renderDockerOperationOutput(formatDockerOperationStreams(error.stdout, error.stderr));
}

function renderDockerOperationOutput(lines: string[]): string {
  return lines.join('\n');
}

function isDockerOperationError(error: RuntimeReleaseErrorInput): error is DockerOperationError {
  return typeof error === 'object' && error !== null && ('logs' in error || 'stderr' in error || 'stdout' in error);
}

function formatDockerOperationLogLine(line: DockerLogLine): string {
  return `[${line.stream}] ${line.message}`;
}

function formatDockerOperationStreams(stdout: string | undefined, stderr: string | undefined): string[] {
  return [...formatDockerOperationOutput('stdout', stdout), ...formatDockerOperationOutput('stderr', stderr)];
}

function formatDockerOperationOutput(stream: 'stderr' | 'stdout', output: string | undefined): string[] {
  if (output === undefined || output.trim() === '') {
    return [];
  }

  return output
    .split(/\r?\n/u)
    .filter((line: string): boolean => line !== '')
    .map((line: string): string => `[${stream}] ${line}`);
}

import { readDockerEngineErrorMessage, tailDockerContainerLogs, type DockerLogLine } from '@compartment/docker';
import type { NodeDeployRequest } from '@compartment/contracts';
import {
  createRuntimeServiceReadinessError,
  createRuntimeServiceStartupError,
  isNodeRuntimeError,
  type NodeRuntimeError,
} from '../errors/node-runtime-error';
import { normalizeRuntimeNetworkDockerError, type RuntimeNetworkErrorInput } from './runtime-network-error.service';

export function throwRuntimeStartupError(error: RuntimeNetworkErrorInput): never {
  throw buildRuntimeStartupError(error);
}

function buildRuntimeStartupError(error: RuntimeNetworkErrorInput): Error {
  const runtimeError: Error = normalizeRuntimeNetworkDockerError(error, 'Unexpected runtime container startup error.');
  if (isNodeRuntimeError(runtimeError)) {
    return runtimeError;
  }

  return createRuntimeServiceStartupError(readRuntimeStartupFailureDetail(runtimeError));
}

export async function buildRuntimeDeploymentError(
  input: NodeDeployRequest,
  containerId: string,
  error: Error,
): Promise<NodeRuntimeError> {
  const detail: string = error.message;
  const logs: string = await readRuntimeFailureLogs(containerId);
  const message: string = logs === '' ? detail : `${detail}\nLast logs:\n${logs}`;

  return input.readiness === null
    ? createRuntimeServiceStartupError(message)
    : createRuntimeServiceReadinessError(message);
}

async function readRuntimeFailureLogs(containerId: string): Promise<string> {
  try {
    const lines: DockerLogLine[] = (await tailDockerContainerLogs({ containerId, tailLines: 50 })).lines;
    return lines
      .map((line: DockerLogLine): string => `[${line.stream}] ${line.message}`)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function readRuntimeStartupFailureDetail(error: Error): string {
  const dockerMessage: string = readDockerEngineErrorMessage(error);
  return dockerMessage === '' ? error.message : dockerMessage;
}

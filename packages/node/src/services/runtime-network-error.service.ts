import {
  isDockerNetworkIpamCapacityError,
  readDockerEngineErrorMessage,
  type DockerEngineError,
} from '@compartment/docker';
import { createRuntimeNetworkIpCapacityExhaustedError, isNodeRuntimeError } from '../errors/node-runtime-error';

export type RuntimeNetworkErrorInput = Error | string | number | boolean | symbol | bigint | null | undefined;

export function normalizeRuntimeNetworkDockerError(error: RuntimeNetworkErrorInput, fallbackMessage: string): Error {
  if (error instanceof Error && isNodeRuntimeError(error)) {
    return error;
  }

  const dockerError: DockerEngineError = error as DockerEngineError;
  if (isDockerNetworkIpamCapacityError(dockerError)) {
    const detail: string = readDockerEngineErrorMessage(dockerError);
    return createRuntimeNetworkIpCapacityExhaustedError(
      detail === '' ? 'Docker Engine could not allocate a runtime network IP address.' : detail,
    );
  }

  return error instanceof Error ? error : new Error(fallbackMessage);
}

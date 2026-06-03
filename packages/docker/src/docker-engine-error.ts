import { hasText } from './docker-client';

interface DockerEngineErrorInfo {
  jsonMessage: string | null;
  message: string | null;
  reason: string | null;
  statusCode: number | null;
}

export type DockerEngineError = DockerEngineErrorRecord | Error | null | undefined;

interface DockerEngineErrorRecord {
  json?: DockerEngineJsonRecord | null | undefined;
  message?: string | null | undefined;
  reason?: string | null | undefined;
  statusCode?: number | null | undefined;
}

interface DockerEngineJsonRecord {
  message?: string | null | undefined;
}

export function isDockerEngineObjectMissingError(error: DockerEngineError, missingText: readonly string[]): boolean {
  const errorInfo: DockerEngineErrorInfo = readDockerEngineErrorInfo(error);
  if (errorInfo.statusCode === 404) {
    return true;
  }

  const errorText: string = buildDockerEngineErrorText(errorInfo);
  return missingText.some((needle: string): boolean => errorText.includes(needle));
}

export function isDockerEngineConflictError(
  error: DockerEngineError,
  conflictText: readonly string[] = ['already exists'],
): boolean {
  const errorInfo: DockerEngineErrorInfo = readDockerEngineErrorInfo(error);
  const errorText: string = buildDockerEngineErrorText(errorInfo);

  return errorInfo.statusCode === 409 || conflictText.some((needle: string): boolean => errorText.includes(needle));
}

export function readDockerEngineErrorMessage(error: DockerEngineError): string {
  return buildDockerEngineErrorMessage(readDockerEngineErrorInfo(error));
}

export function isDockerNetworkIpamCapacityError(error: DockerEngineError): boolean {
  const errorText: string = readDockerEngineErrorText(error);
  return (
    errorText.includes('all predefined address pools have been fully subnetted') ||
    errorText.includes('could not find an available, non-overlapping ipv4 address pool') ||
    errorText.includes('could not find an available ip address') ||
    errorText.includes('no available ipv4 addresses') ||
    errorText.includes('overlaps with other one on this address space')
  );
}

export function readDockerEngineErrorText(error: DockerEngineError): string {
  return buildDockerEngineErrorText(readDockerEngineErrorInfo(error));
}

function buildDockerEngineErrorText(errorInfo: DockerEngineErrorInfo): string {
  return buildDockerEngineErrorMessage(errorInfo).toLowerCase();
}

function buildDockerEngineErrorMessage(errorInfo: DockerEngineErrorInfo): string {
  return [errorInfo.message, errorInfo.reason, errorInfo.jsonMessage].filter(hasText).join(' ');
}

function readDockerEngineErrorInfo(error: DockerEngineError): DockerEngineErrorInfo {
  if (typeof error !== 'object' || error === null) {
    return {
      jsonMessage: null,
      message: null,
      reason: null,
      statusCode: null,
    };
  }

  const record: DockerEngineErrorRecord = error;
  return {
    jsonMessage: readDockerEngineJsonMessage(record.json),
    message: typeof record.message === 'string' ? record.message : null,
    reason: typeof record.reason === 'string' ? record.reason : null,
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : null,
  };
}

function readDockerEngineJsonMessage(value: object | null | undefined): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record: DockerEngineJsonRecord = value;
  return typeof record.message === 'string' ? record.message : null;
}

import type { EdgeBootstrapFetchError } from './edge-bootstrap.service.types';

const edgeSnapshotFallbackCauseCodes: ReadonlySet<string> = new Set(['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);

export function isEdgeSnapshotFallbackError(error: Error): boolean {
  const causeCode: string | null = readEdgeBootstrapCauseCode(error);
  return causeCode !== null && edgeSnapshotFallbackCauseCodes.has(causeCode);
}

export function isRetryableEdgeBootstrapError(error: Error): boolean {
  return readEdgeBootstrapCauseCode(error) === 'ECONNREFUSED';
}

function readEdgeBootstrapCauseCode(error: Error): string | null {
  const fetchError: EdgeBootstrapFetchError = error as EdgeBootstrapFetchError;
  return typeof fetchError.cause?.code === 'string' ? fetchError.cause.code : null;
}

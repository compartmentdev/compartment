import type { JsonValue } from '@compartment/utils';

interface NodeRequestErrorInput {
  path: string;
  payload: JsonValue;
  status: number;
}

interface NodeRuntimeErrorPayload extends Record<string, JsonValue> {
  error: JsonValue;
}

interface NodeRuntimeErrorDetail extends Record<string, JsonValue> {
  message: string;
}

export class NodeRequestError extends Error {
  readonly path: string;
  readonly runtimeMessage: string | null;
  readonly status: number;

  constructor(input: NodeRequestErrorInput) {
    super(createNodeRequestFailureMessage(input.status, input.path, input.payload));
    this.name = 'NodeRequestError';
    this.path = input.path;
    this.runtimeMessage = readNodeRuntimeMessage(input.payload);
    this.status = input.status;
  }
}

export function readNodeRequestRuntimeMessage(error: Error): string | null {
  return error instanceof NodeRequestError ? error.runtimeMessage : null;
}

function createNodeRequestFailureMessage(status: number, path: string, payload: JsonValue): string {
  return `Node runtime request failed for ${path} with status ${status.toString()}: ${JSON.stringify(payload)}.`;
}

function readNodeRuntimeMessage(payload: JsonValue): string | null {
  const errorPayload: JsonValue | null = readNodeRuntimeErrorPayload(payload);
  if (isNodeRuntimeErrorDetail(errorPayload)) {
    return errorPayload.message;
  }

  return null;
}

function readNodeRuntimeErrorPayload(payload: JsonValue): JsonValue | null {
  return isNodeRuntimeErrorPayload(payload) ? payload.error : null;
}

function isNodeRuntimeErrorPayload(value: JsonValue): value is NodeRuntimeErrorPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'error' in value;
}

function isNodeRuntimeErrorDetail(value: JsonValue): value is NodeRuntimeErrorDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'message' in value &&
    typeof (value as Partial<NodeRuntimeErrorDetail>).message === 'string'
  );
}

import { errorResponseSchema, type ErrorDetails, type ErrorResponse } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { SafeParseReturnType } from 'zod';

interface NodeRequestErrorInput {
  path: string;
  payload: JsonValue;
  status: number;
}

export class NodeRequestError extends Error {
  readonly path: string;
  readonly runtimeError: ErrorDetails | null;
  readonly runtimeMessage: string | null;
  readonly status: number;

  constructor(input: NodeRequestErrorInput) {
    super(createNodeRequestFailureMessage(input.status, input.path, input.payload));
    this.name = 'NodeRequestError';
    this.path = input.path;
    this.runtimeError = readNodeRuntimeError(input.payload);
    this.runtimeMessage = this.runtimeError?.message ?? null;
    this.status = input.status;
  }
}

export function readNodeRequestRuntimeError(error: Error): ErrorDetails | null {
  return error instanceof NodeRequestError ? error.runtimeError : null;
}

export function readNodeRequestRuntimeMessage(error: Error): string | null {
  return error instanceof NodeRequestError ? error.runtimeMessage : null;
}

function createNodeRequestFailureMessage(status: number, path: string, payload: JsonValue): string {
  return `Node runtime request failed for ${path} with status ${status.toString()}: ${JSON.stringify(payload)}.`;
}

function readNodeRuntimeError(payload: JsonValue): ErrorDetails | null {
  const parsedError: SafeParseReturnType<JsonValue, ErrorResponse> = errorResponseSchema.safeParse(payload);
  return parsedError.success ? parsedError.data.error : null;
}

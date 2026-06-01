import {
  nodeRuntimeDockerErrorCode,
  nodeRuntimeNetworkCapacityExhaustedErrorCode,
  nodeRuntimeResourceReadinessFailedErrorCode,
  nodeRuntimeServiceReadinessFailedErrorCode,
  nodeRuntimeServiceStartupFailedErrorCode,
  type NodeRuntimeNetworkErrorCode,
  type NodeRuntimeResourceErrorCode,
  type NodeRuntimeServiceErrorCode,
} from '@compartment/contracts';

type RuntimeResourceReadinessPhase = 'restore' | 'startup';

interface RuntimeResourceReadinessErrorInput {
  phase: RuntimeResourceReadinessPhase;
  resourceName: string;
  timeoutMs: number;
}

export type NodeRuntimeErrorCode =
  | NodeRuntimeNetworkErrorCode
  | NodeRuntimeResourceErrorCode
  | NodeRuntimeServiceErrorCode;

export interface NodeRuntimeError extends Error {
  readonly code: NodeRuntimeErrorCode;
}

class NodeRuntimeErrorImpl extends Error implements NodeRuntimeError {
  public readonly code: NodeRuntimeErrorCode;

  public constructor(code: NodeRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'NodeRuntimeError';
    this.code = code;
  }
}

export function createRuntimeResourceReadinessError(input: RuntimeResourceReadinessErrorInput): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(nodeRuntimeResourceReadinessFailedErrorCode, createResourceReadinessMessage(input));
}

export function createRuntimeServiceReadinessError(detail: string): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(nodeRuntimeServiceReadinessFailedErrorCode, `runtime readiness failed: ${detail}`);
}

export function createRuntimeServiceStartupError(detail: string): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(nodeRuntimeServiceStartupFailedErrorCode, `runtime startup failed: ${detail}`);
}

export function createRuntimeNetworkCapacityExhaustedError(detail: string): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(
    nodeRuntimeNetworkCapacityExhaustedErrorCode,
    `Docker runtime network pool exhausted. ${detail}`,
  );
}

export function createRuntimeNetworkIpCapacityExhaustedError(detail: string): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(
    nodeRuntimeNetworkCapacityExhaustedErrorCode,
    `Docker runtime network IP capacity exhausted. ${detail}`,
  );
}

export function createRuntimeDockerError(detail: string): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(nodeRuntimeDockerErrorCode, `Docker runtime network operation failed. ${detail}`);
}

export function isNodeRuntimeError(value: Error | null | undefined): value is NodeRuntimeError {
  return value instanceof NodeRuntimeErrorImpl;
}

function createResourceReadinessMessage(input: RuntimeResourceReadinessErrorInput): string {
  const restorePrefix: string = input.phase === 'restore' ? 'after restore ' : '';

  return `Resource ${input.resourceName} did not become ready ${restorePrefix}before ${input.timeoutMs.toString()}ms.`;
}

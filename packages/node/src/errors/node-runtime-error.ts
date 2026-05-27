import { nodeRuntimeResourceReadinessFailedErrorCode, type NodeRuntimeResourceErrorCode } from '@compartment/contracts';

type RuntimeResourceReadinessPhase = 'restore' | 'startup';

interface RuntimeResourceReadinessErrorInput {
  phase: RuntimeResourceReadinessPhase;
  resourceName: string;
  timeoutMs: number;
}

export interface NodeRuntimeError extends Error {
  readonly code: NodeRuntimeResourceErrorCode;
}

class NodeRuntimeErrorImpl extends Error implements NodeRuntimeError {
  public readonly code: NodeRuntimeResourceErrorCode;

  public constructor(code: NodeRuntimeResourceErrorCode, message: string) {
    super(message);
    this.name = 'NodeRuntimeError';
    this.code = code;
  }
}

export function createRuntimeResourceReadinessError(input: RuntimeResourceReadinessErrorInput): NodeRuntimeError {
  return new NodeRuntimeErrorImpl(nodeRuntimeResourceReadinessFailedErrorCode, createResourceReadinessMessage(input));
}

export function isNodeRuntimeError(value: Error | null | undefined): value is NodeRuntimeError {
  return value instanceof NodeRuntimeErrorImpl;
}

function createResourceReadinessMessage(input: RuntimeResourceReadinessErrorInput): string {
  const restorePrefix: string = input.phase === 'restore' ? 'after restore ' : '';

  return `Resource ${input.resourceName} did not become ready ${restorePrefix}before ${input.timeoutMs.toString()}ms.`;
}

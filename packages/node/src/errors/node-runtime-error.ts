import { nodeRuntimeResourceReadinessFailedErrorCode, type NodeRuntimeResourceErrorCode } from '@compartment/contracts';

type NodeRuntimeErrorCode = NodeRuntimeResourceErrorCode;

type RuntimeResourceReadinessPhase = 'restore' | 'startup';

interface RuntimeResourceReadinessErrorInput {
  phase: RuntimeResourceReadinessPhase;
  resourceName: string;
  timeoutMs: number;
}

interface NodeRuntimeErrorShape extends Error {
  readonly code: NodeRuntimeErrorCode;
}

class NodeRuntimeError extends Error implements NodeRuntimeErrorShape {
  public readonly code: NodeRuntimeErrorCode;

  public constructor(code: NodeRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'NodeRuntimeError';
    this.code = code;
  }
}

export function createRuntimeResourceReadinessError(input: RuntimeResourceReadinessErrorInput): NodeRuntimeErrorShape {
  return new NodeRuntimeError(nodeRuntimeResourceReadinessFailedErrorCode, createResourceReadinessMessage(input));
}

export function isNodeRuntimeError(value: Error | null | undefined): value is NodeRuntimeErrorShape {
  return value instanceof NodeRuntimeError;
}

function createResourceReadinessMessage(input: RuntimeResourceReadinessErrorInput): string {
  const restorePrefix: string = input.phase === 'restore' ? 'after restore ' : '';

  return `Resource ${input.resourceName} did not become ready ${restorePrefix}before ${input.timeoutMs.toString()}ms.`;
}

import { createId } from '../lib/tokens';
import { createNode, findNodeByName, findRegisteredNode, updateNodeRegistration } from '../queries/node.query';
import type { NodeRow } from '../queries/node.query.types';
import { insertOperationRecord } from '../queries/operations.query';
import type { NodeMutationContext, NodeRegistrationInput, NodeRegistrationResult } from './node.service.types';

export async function registerNode(input: NodeRegistrationInput): Promise<NodeRegistrationResult> {
  const existingNode: NodeRow | undefined = await findNodeByName(input.nodeName);

  if (existingNode !== undefined) {
    return await updateRegisteredNode(existingNode, input);
  }

  return await createRegisteredNode(input);
}

export async function resolveRegisteredNode(): Promise<NodeRow | undefined> {
  return await findRegisteredNode();
}

async function updateRegisteredNode(
  existingNode: NodeRow,
  input: NodeRegistrationInput,
): Promise<NodeRegistrationResult> {
  const context: NodeMutationContext = createNodeContext();

  await updateNodeRegistration({
    nodeId: existingNode.id,
    nodeSocketPath: input.nodeSocketPath,
    nodeVersion: input.nodeVersion,
    updatedAt: context.now,
  });

  const node: NodeRow = buildUpdatedRegisteredNode(existingNode, input, context);
  await recordNodeOperation(node, context.now, `Node registered: ${node.name}`);

  return {
    node,
    registeredAt: context.now,
  };
}

async function createRegisteredNode(input: NodeRegistrationInput): Promise<NodeRegistrationResult> {
  const context: NodeMutationContext = createNodeContext();
  const node: NodeRow = buildCreatedNode(input, context);

  await createNode({
    id: node.id,
    name: node.name,
    nodeSocketPath: node.nodeSocketPath,
    nodeVersion: node.nodeVersion,
    updatedAt: node.updatedAt,
  });
  await recordNodeOperation(node, context.now, `Node registered: ${node.name}`);

  return {
    node,
    registeredAt: context.now,
  };
}

function createNodeContext(): NodeMutationContext {
  return {
    now: new Date(),
  };
}

function buildUpdatedRegisteredNode(
  existingNode: NodeRow,
  input: NodeRegistrationInput,
  context: NodeMutationContext,
): NodeRow {
  return {
    ...existingNode,
    nodeSocketPath: input.nodeSocketPath,
    nodeVersion: input.nodeVersion,
    updatedAt: context.now,
  };
}

function buildCreatedNode(input: NodeRegistrationInput, context: NodeMutationContext): NodeRow {
  return {
    createdAt: context.now,
    id: createId('node'),
    name: input.nodeName,
    nodeSocketPath: input.nodeSocketPath,
    nodeVersion: input.nodeVersion,
    updatedAt: context.now,
  };
}

async function recordNodeOperation(node: NodeRow, now: Date, summary: string): Promise<void> {
  await insertOperationRecord({
    completedAt: now,
    status: 'succeeded',
    summary,
    targetId: node.id,
    targetType: 'node',
    type: 'node.register',
  });
}

import { desc, eq } from 'drizzle-orm';
import { nodes } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { CreateNodeInput, NodeRow, UpdateNodeRegistrationInput } from './node.query.types';

export async function findNodeById(nodeId: string): Promise<NodeRow | undefined> {
  const rows: NodeRow[] = await getApiDatabase().select().from(nodes).where(eq(nodes.id, nodeId));

  return rows[0];
}

export async function findNodeByName(nodeName: string): Promise<NodeRow | undefined> {
  const rows: NodeRow[] = await getApiDatabase().select().from(nodes).where(eq(nodes.name, nodeName));

  return rows[0];
}

export async function createNode(input: CreateNodeInput): Promise<void> {
  await getApiDatabase().insert(nodes).values({
    id: input.id,
    name: input.name,
    nodeUrl: input.nodeSocketPath,
    nodeSocketPath: input.nodeSocketPath,
    nodeVersion: input.nodeVersion,
    updatedAt: input.updatedAt,
  });
}

export async function updateNodeRegistration({
  nodeId,
  nodeSocketPath,
  nodeVersion,
  updatedAt,
}: UpdateNodeRegistrationInput): Promise<void> {
  await getApiDatabase()
    .update(nodes)
    .set({
      nodeUrl: nodeSocketPath,
      nodeSocketPath,
      nodeVersion,
      updatedAt,
    })
    .where(eq(nodes.id, nodeId));
}

export async function findRegisteredNode(): Promise<NodeRow | undefined> {
  const rows: NodeRow[] = await getApiDatabase().select().from(nodes).orderBy(desc(nodes.updatedAt)).limit(1);

  return rows[0];
}

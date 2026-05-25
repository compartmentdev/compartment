import type { NodeRow } from '../queries/node.query.types';

export interface NodeRegistrationInput {
  nodeName: string;
  nodeSocketPath: string;
  nodeVersion: string;
}

export interface NodeRegistrationResult {
  node: NodeRow;
  registeredAt: Date;
}

export interface NodeMutationContext {
  now: Date;
}

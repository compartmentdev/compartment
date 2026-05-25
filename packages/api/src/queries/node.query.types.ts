export interface NodeRow {
  createdAt: Date;
  id: string;
  name: string;
  nodeSocketPath: string;
  nodeVersion: string;
  updatedAt: Date;
}

export interface CreateNodeInput {
  id: string;
  name: string;
  nodeSocketPath: string;
  nodeVersion: string;
  updatedAt: Date;
}

export interface UpdateNodeRegistrationInput {
  nodeId: string;
  nodeSocketPath: string;
  nodeVersion: string;
  updatedAt: Date;
}

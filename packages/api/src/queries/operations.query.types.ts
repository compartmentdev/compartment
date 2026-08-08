import type { OperationStatus } from '@compartment/contracts';

export interface InsertOperationInput {
  actorPrincipalId?: string;
  completedAt?: Date;
  organizationId: string | null;
  status: OperationStatus;
  summary: string;
  targetId: string;
  targetType: string;
  type: string;
}

export interface OperationRecord {
  actorPrincipalId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  id: string;
  organizationId: string | null;
  status: OperationStatus;
  summary: string;
  targetId: string;
  targetType: string;
  type: string;
}

export interface NewOperationRecord {
  actorPrincipalId?: string | null | undefined;
  completedAt?: Date | null | undefined;
  id: string;
  organizationId: string | null;
  status: OperationStatus;
  summary: string;
  targetId: string;
  targetType: string;
  type: string;
}

export interface UpdateOperationInput {
  completedAt?: Date | null | undefined;
  operationId: string;
  organizationId: string;
  status: OperationStatus;
  summary?: string | undefined;
}

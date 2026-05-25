import {
  systemDomainPendingStatusSchema,
  type DomainHostPlan,
  type SystemDomainPendingStatus,
} from '@compartment/contracts';
import { createDomainNoPendingOperationError } from '../errors/api-business-error';
import { findSystemDomainSetupStateWithExecutor } from '../queries/system-domain.query';
import type { SystemDomainSetupStateRow, SystemDomainTransaction } from '../queries/system-domain.query.types';
import { readPendingDomainHostPlan } from './system-domain-status.mapper';

export interface PendingSystemDomainState {
  hostPlan: DomainHostPlan;
  operationId: string;
  setupState: SystemDomainSetupStateRow;
  status: SystemDomainPendingStatus;
}

export async function requirePendingSystemDomainState(tx: SystemDomainTransaction): Promise<PendingSystemDomainState> {
  const setupState: SystemDomainSetupStateRow = await requireSystemDomainSetupState(tx);

  return {
    hostPlan: readRequiredPendingHostPlan(setupState),
    operationId: readRequiredPendingOperationId(setupState),
    setupState,
    status: readRequiredPendingStatus(setupState.pendingStatus),
  };
}

async function requireSystemDomainSetupState(tx: SystemDomainTransaction): Promise<SystemDomainSetupStateRow> {
  const setupState: SystemDomainSetupStateRow | undefined = await findSystemDomainSetupStateWithExecutor(tx);
  if (setupState === undefined) {
    throw createDomainNoPendingOperationError();
  }

  return setupState;
}

function readRequiredPendingHostPlan(setupState: SystemDomainSetupStateRow): DomainHostPlan {
  readRequiredPendingStatus(setupState.pendingStatus);
  return readPendingDomainHostPlan(setupState);
}

function readRequiredPendingOperationId(setupState: SystemDomainSetupStateRow): string {
  return requirePendingText(setupState.pendingOperationId);
}

function readRequiredPendingStatus(value: string | null): SystemDomainPendingStatus {
  try {
    return systemDomainPendingStatusSchema.parse(value);
  } catch {
    throw createDomainNoPendingOperationError();
  }
}

function requirePendingText(value: string | null): string {
  if (value === null) {
    throw createDomainNoPendingOperationError();
  }

  return value;
}

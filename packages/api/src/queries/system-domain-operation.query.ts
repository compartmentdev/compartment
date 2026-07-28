import { and, eq, type SQL } from 'drizzle-orm';
import { systemDomainSetupState } from '../db/schema';
import {
  buildClearedSystemDomainPendingValues,
  buildNextSystemDomainSetupVersion,
  buildPendingSystemDomainOperationPredicate,
} from './system-domain-setup-state.helpers';
import type { SystemDomainSetupStateRow } from './system-domain.query.types';
import type {
  SystemDomainOperationQueryResult,
  SystemDomainOperationTransaction,
  SystemDomainPendingCertificateInput,
  SystemDomainPendingStatusUpdateInput,
  VerifiedSystemDomainPendingInput,
} from './system-domain-operation.query.types';

interface SystemDomainPendingStatusUpdateValues {
  setupVersion: SQL;
  pendingFailureCode: string | null;
  pendingFailureMessage: string | null;
  pendingStatus: string;
  updatedAt: Date;
}

interface SystemDomainPendingCertificateValues {
  setupVersion: SQL;
  pendingCertificateMetadataJson: string;
  pendingTlsSecretName: string;
  pendingFailureCode: null;
  pendingFailureMessage: null;
  pendingStatus: 'pending_cert';
  updatedAt: Date;
}

export async function updateSystemDomainPendingStatusWithExecutor(
  tx: SystemDomainOperationTransaction,
  input: SystemDomainPendingStatusUpdateInput,
): Promise<SystemDomainOperationQueryResult | null> {
  const [updatedSetupState]: SystemDomainSetupStateRow[] = await tx
    .update(systemDomainSetupState)
    .set(buildSystemDomainPendingStatusUpdateValues(input))
    .where(buildPendingSystemDomainOperationPredicate(input.expectedSetupVersion, input.operationId))
    .returning();

  return updatedSetupState === undefined ? null : { operationId: input.operationId, setupState: updatedSetupState };
}

export async function attachSystemDomainPendingCertificateWithExecutor(
  tx: SystemDomainOperationTransaction,
  input: SystemDomainPendingCertificateInput,
): Promise<SystemDomainOperationQueryResult | null> {
  const [updatedSetupState]: SystemDomainSetupStateRow[] = await tx
    .update(systemDomainSetupState)
    .set(buildSystemDomainPendingCertificateValues(input))
    .where(buildPendingSystemDomainOperationPredicate(input.expectedSetupVersion, input.operationId))
    .returning();

  return updatedSetupState === undefined ? null : { operationId: input.operationId, setupState: updatedSetupState };
}

export async function completeSystemDomainPendingWithExecutor(
  tx: SystemDomainOperationTransaction,
  input: VerifiedSystemDomainPendingInput,
): Promise<SystemDomainOperationQueryResult | null> {
  const [updatedSetupState]: SystemDomainSetupStateRow[] = await tx
    .update(systemDomainSetupState)
    .set(buildClearedSystemDomainPendingValues())
    .where(buildVerifiedPendingOperationPredicate(input.expectedSetupVersion, input.operationId))
    .returning();

  return updatedSetupState === undefined ? null : { operationId: input.operationId, setupState: updatedSetupState };
}

function buildSystemDomainPendingStatusUpdateValues(
  input: SystemDomainPendingStatusUpdateInput,
): SystemDomainPendingStatusUpdateValues {
  return {
    setupVersion: buildNextSystemDomainSetupVersion(),
    pendingFailureCode: input.failureCode,
    pendingFailureMessage: input.failureMessage,
    pendingStatus: input.pendingStatus,
    updatedAt: new Date(),
  };
}

function buildSystemDomainPendingCertificateValues(
  input: SystemDomainPendingCertificateInput,
): SystemDomainPendingCertificateValues {
  return {
    setupVersion: buildNextSystemDomainSetupVersion(),
    pendingCertificateMetadataJson: input.pendingCertificateMetadataJson,
    pendingTlsSecretName: input.pendingTlsSecretName,
    pendingFailureCode: null,
    pendingFailureMessage: null,
    pendingStatus: 'pending_cert',
    updatedAt: new Date(),
  };
}

function buildVerifiedPendingOperationPredicate(expectedVersion: number, operationId: string): SQL | undefined {
  return and(
    buildPendingSystemDomainOperationPredicate(expectedVersion, operationId),
    eq(systemDomainSetupState.pendingStatus, 'verified'),
  );
}

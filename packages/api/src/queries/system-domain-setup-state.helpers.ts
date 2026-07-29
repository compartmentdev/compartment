import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { systemDomainSetupState } from '../db/schema';

export const defaultSystemDomainSetupStateId: string = 'system-domain-setup';

interface ClearedSystemDomainPendingValues {
  setupVersion: SQL;
  pendingBaseDomain: null;
  pendingDomainKind: null;
  pendingIssuerRefJson: null;
  pendingFailureCode: null;
  pendingFailureMessage: null;
  pendingOperationId: null;
  pendingPublicScheme: null;
  pendingRequiredDnsRecordsJson: null;
  pendingStatus: null;
  pendingTlsMode: null;
  updatedAt: Date;
}

export function buildClearedSystemDomainPendingValues(): ClearedSystemDomainPendingValues {
  return {
    setupVersion: buildNextSystemDomainSetupVersion(),
    pendingBaseDomain: null,
    pendingDomainKind: null,
    pendingIssuerRefJson: null,
    pendingFailureCode: null,
    pendingFailureMessage: null,
    pendingOperationId: null,
    pendingPublicScheme: null,
    pendingRequiredDnsRecordsJson: null,
    pendingStatus: null,
    pendingTlsMode: null,
    updatedAt: new Date(),
  };
}

export function buildNextSystemDomainSetupVersion(): SQL {
  return sql`${systemDomainSetupState.setupVersion} + 1`;
}

export function buildPendingSystemDomainOperationPredicate(
  expectedVersion: number,
  operationId: string,
): SQL | undefined {
  return and(
    buildVersionedSystemDomainSetupPredicate(expectedVersion),
    eq(systemDomainSetupState.pendingOperationId, operationId),
    isNotNull(systemDomainSetupState.pendingStatus),
  );
}

export function buildVersionedSystemDomainSetupPredicate(expectedVersion: number): SQL | undefined {
  return and(
    eq(systemDomainSetupState.id, defaultSystemDomainSetupStateId),
    eq(systemDomainSetupState.setupVersion, expectedVersion),
  );
}

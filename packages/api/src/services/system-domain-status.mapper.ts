import {
  domainDnsRecordSchema,
  domainHostPlanSchema,
  isCustomCertificateDomainHostPlan,
  isCustomHttpDomainHostPlan,
  systemDomainCertificateSchema,
  systemDomainPendingStatusSchema,
  systemDomainStatusResponseSchema,
  type DomainDnsRecord,
  type DomainHostPlan,
  type SystemDomainCertificate,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import {
  buildPendingSystemDomainCertificatePaths,
  type JsonValue,
  type PendingSystemDomainCertificatePaths,
} from '@compartment/utils';
import { z } from 'zod';
import { readApiPublicIngressConfig, type ApiPublicIngressConfig } from '../config';
import type { SystemDomainMutationQueryResult, SystemDomainSetupStateRow } from '../queries/system-domain.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { buildRequiredSystemDomainDnsRecords } from './system-domain-dns-proof.service';
import type {
  SystemDomainHealthResult,
  SystemDomainMutationResult,
  SystemDomainPendingResult,
  SystemDomainStatusResult,
} from './system-domain.service.types';

const domainDnsRecordListSchema: z.ZodType<DomainDnsRecord[]> = z.array(domainDnsRecordSchema);

interface SystemDomainStatusMapperInput {
  active: DomainHostPlan;
  activeDomainHealth: SystemDomainHealthResult;
  setupState: SystemDomainSetupStateRow | undefined;
}

export function createSystemDomainMutationResult(
  mutationResult: SystemDomainMutationQueryResult,
  active: DomainHostPlan,
  activeDomainHealth: SystemDomainHealthResult = createUnknownSystemDomainHealth(),
): SystemDomainMutationResult {
  const status: SystemDomainStatusResult = mapSystemDomainStatus({
    active,
    activeDomainHealth,
    setupState: mutationResult.setupState,
  });

  return {
    operationId: mutationResult.operationId,
    setupVersion: status.setupVersion,
    status,
  };
}

export function mapSystemDomainStatus(input: SystemDomainStatusMapperInput): SystemDomainStatusResult {
  return systemDomainStatusResponseSchema.parse({
    active: input.active,
    activeDomainHealth: input.activeDomainHealth,
    pending: input.setupState === undefined ? null : mapPendingDomainOperation(input.setupState),
    setupVersion: input.setupState?.setupVersion ?? 0,
  }) satisfies SystemDomainStatusResponse;
}

export function createUnknownSystemDomainHealth(): SystemDomainHealthResult {
  return {
    checkedAt: null,
    failureCode: null,
    failureMessage: null,
    status: 'unknown',
  };
}

function mapPendingDomainOperation(setupState: SystemDomainSetupStateRow): SystemDomainPendingResult | null {
  if (setupState.pendingStatus === null || setupState.pendingOperationId === null) {
    return null;
  }
  const hostPlan: DomainHostPlan = readPendingDomainHostPlan(setupState);

  return {
    certificate: readPendingCertificate(setupState),
    failureCode: setupState.pendingFailureCode,
    failureMessage: setupState.pendingFailureMessage,
    hostPlan,
    operationId: setupState.pendingOperationId,
    requiredDnsRecords: readPendingRequiredDnsRecords(setupState, hostPlan),
    status: systemDomainPendingStatusSchema.parse(setupState.pendingStatus),
  };
}

function readPendingCertificate(setupState: SystemDomainSetupStateRow): SystemDomainCertificate | null {
  if (setupState.pendingCertificateMetadataJson === null || setupState.pendingOperationId === null) {
    return null;
  }
  const paths: PendingSystemDomainCertificatePaths = buildPendingSystemDomainCertificatePaths(
    getApiConfig().customTlsDirectory,
    setupState.pendingOperationId,
  );

  return systemDomainCertificateSchema.parse({
    certificatePath: paths.certificatePath,
    metadata: readPendingCertificateMetadataJson(setupState.pendingCertificateMetadataJson),
    privateKeyPath: paths.privateKeyPath,
  });
}

function readPendingCertificateMetadataJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

export function readPendingDomainHostPlan(setupState: SystemDomainSetupStateRow): DomainHostPlan {
  return domainHostPlanSchema.parse({
    baseDomain: requirePendingText(setupState.pendingBaseDomain),
    caddyMode: requirePendingText(setupState.pendingCaddyMode),
    domainKind: requirePendingText(setupState.pendingDomainKind),
    publicScheme: requirePendingText(setupState.pendingPublicScheme),
    tlsMode: requirePendingText(setupState.pendingTlsMode),
  });
}

function readPendingRequiredDnsRecords(
  setupState: SystemDomainSetupStateRow,
  hostPlan: DomainHostPlan,
): DomainDnsRecord[] {
  const liveRecords: DomainDnsRecord[] | null = buildLivePendingRequiredDnsRecords(setupState, hostPlan);
  if (liveRecords !== null) {
    return liveRecords;
  }

  return readStoredPendingRequiredDnsRecords(setupState);
}

function buildLivePendingRequiredDnsRecords(
  setupState: SystemDomainSetupStateRow,
  hostPlan: DomainHostPlan,
): DomainDnsRecord[] | null {
  if (!isCustomPendingHostPlan(hostPlan)) {
    return null;
  }

  const publicIngressConfig: ApiPublicIngressConfig = readApiPublicIngressConfig();
  if (!hasConfiguredPublicIngress(publicIngressConfig)) {
    return null;
  }

  return buildRequiredSystemDomainDnsRecords({
    managedDomainBrokerToken: getApiConfig().managedDomainBrokerToken ?? null,
    pendingBaseDomain: hostPlan.baseDomain,
    pendingOperationId: requirePendingText(setupState.pendingOperationId),
    publicIngressConfig,
  });
}

function readStoredPendingRequiredDnsRecords(setupState: SystemDomainSetupStateRow): DomainDnsRecord[] {
  const storedValue: JsonValue = JSON.parse(requirePendingText(setupState.pendingRequiredDnsRecordsJson)) as JsonValue;
  const currentRecordsParseResult: z.SafeParseReturnType<JsonValue, DomainDnsRecord[]> =
    domainDnsRecordListSchema.safeParse(storedValue);
  if (currentRecordsParseResult.success) {
    return currentRecordsParseResult.data;
  }

  throw currentRecordsParseResult.error;
}

function isCustomPendingHostPlan(hostPlan: DomainHostPlan): boolean {
  return isCustomHttpDomainHostPlan(hostPlan) || isCustomCertificateDomainHostPlan(hostPlan);
}

function hasConfiguredPublicIngress(publicIngressConfig: ApiPublicIngressConfig): boolean {
  return publicIngressConfig.publicIngressIpv4 !== null || publicIngressConfig.publicIngressIpv6 !== null;
}

function requirePendingText(value: string | null): string {
  if (value === null) {
    throw new Error('Pending domain setup state is incomplete.');
  }

  return value;
}

import type { CustomDomainCheckStatus, CustomDomainState } from '@compartment/contracts';

export interface CustomDomainRow {
  createdAt: Date;
  environmentId: string;
  environmentName: string;
  failureMessage: string | null;
  host: string;
  id: string;
  lastCheckedAt: Date | null;
  organizationId: string;
  ownershipStatus: CustomDomainCheckStatus;
  reconcileState: CustomDomainState;
  desiredGeneration: number;
  edgeRoutingEnabled: boolean;
  observedGeneration: number;
  observedIngressPresent: boolean;
  observedCertificatePresent: boolean;
  observedCertificateReady: boolean;
  reconcileLeaseExpiresAt: Date | null;
  reconcileLeaseId: string | null;
  projectId: string;
  projectName: string;
  routingStatus: CustomDomainCheckStatus;
  serviceId: string;
  serviceName: string;
  updatedAt: Date;
  verificationTokenHash: string;
  verifiedAt: Date | null;
}

export interface InsertCustomDomainInput {
  createdByPrincipalId: string;
  environmentId: string;
  host: string;
  id: string;
  projectServiceId: string;
  updatedAt: Date;
  verificationTokenHash: string;
}

export interface ListCustomDomainsInput {
  environmentName?: string | undefined;
  organizationId: string;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface UpdateCustomDomainCheckInput {
  failureMessage: string | null;
  host: string;
  id: string;
  lastCheckedAt: Date | null;
  ownershipStatus: CustomDomainCheckStatus;
  reconcileState: CustomDomainState;
  desiredGeneration: number;
  routingStatus: CustomDomainCheckStatus;
  updatedAt: Date;
  verifiedAt: Date | null;
}

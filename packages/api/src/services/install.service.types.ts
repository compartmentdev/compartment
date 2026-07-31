import type { DnsRecordInstruction } from '@compartment/contracts';
import type { OperationRecord } from '../queries/operations.query.types';
import type { AuthSessionPlan } from './auth-session.types';

export interface InstallServiceInput {
  adminEmail: string;
  adminPassword: string;
  baseDomain: string;
  organizationName: string;
  organizationSlug?: string | undefined;
}

export interface InstallPlan {
  baseDomain: string;
  dnsRecords: DnsRecordInstruction[];
  adminAssignmentId: string;
  organizationMembershipId: string;
  organizationId: string;
  organizationSlug: string;
  compartmentUrl: string;
  principalId: string;
  session: AuthSessionPlan;
}

export interface InstallResult {
  adminEmail: string;
  baseDomain: string;
  dnsRecords: DnsRecordInstruction[];
  operation: OperationRecord;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  principalId: string;
  sessionId: string;
  compartmentUrl: string;
  sessionToken: string;
}

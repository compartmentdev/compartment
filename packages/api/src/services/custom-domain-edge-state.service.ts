import { updateCustomDomainCheck } from '../queries/custom-domains.query';
import type { CustomDomainRow } from '../queries/custom-domains.query.types';
import type { CustomDomainDnsVerificationResult } from './custom-domain-dns.service.types';

export async function persistCustomDomainVerificationResult(
  row: CustomDomainRow,
  host: string,
  result: CustomDomainDnsVerificationResult,
): Promise<void> {
  const now: Date = new Date();
  const verifiedAt: Date | null = readCustomDomainVerifiedAt(row, result, now);
  await updateCustomDomainCheck({
    desiredGeneration: row.desiredGeneration + 1,
    failureMessage: result.failureMessage,
    host,
    id: row.id,
    lastCheckedAt: now,
    organizationId: row.organizationId,
    ownershipStatus: result.ownershipStatus,
    reconcileState: isVerifiedCustomDomainResult(result) ? 'reconciling' : 'failed',
    routingStatus: result.routingStatus,
    updatedAt: now,
    verifiedAt,
  });
}

function readCustomDomainVerifiedAt(
  row: CustomDomainRow,
  result: CustomDomainDnsVerificationResult,
  now: Date,
): Date | null {
  if (row.verifiedAt !== null) {
    return row.verifiedAt;
  }

  return isVerifiedCustomDomainResult(result) ? now : null;
}

function isVerifiedCustomDomainResult(result: CustomDomainDnsVerificationResult): boolean {
  return result.ownershipStatus === 'valid' && result.routingStatus === 'valid';
}

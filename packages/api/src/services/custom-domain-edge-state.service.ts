import { updateCustomDomainCheck } from '../queries/custom-domains.query';
import type { CustomDomainRow } from '../queries/custom-domains.query.types';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import type { CustomDomainDnsVerificationResult } from './custom-domain-dns.service.types';

export async function persistCustomDomainVerificationResult(
  row: CustomDomainRow,
  host: string,
  result: CustomDomainDnsVerificationResult,
): Promise<void> {
  const now: Date = new Date();
  const verifiedAt: Date | null = readCustomDomainVerifiedAt(row, result, now);
  await updateCustomDomainCheck({
    failureMessage: result.failureMessage,
    host,
    id: row.id,
    lastCheckedAt: now,
    ownershipStatus: result.ownershipStatus,
    routingStatus: result.routingStatus,
    updatedAt: now,
    verifiedAt,
  });
  if (shouldSyncEdgeAfterCustomDomainVerification(row, result)) {
    await synchronizeEdgeAppAccessState();
  }
}

export async function syncEdgeBeforeCustomDomainRemoval(row: CustomDomainRow, host: string): Promise<void> {
  if (!wasEverVerifiedCustomDomainRow(row)) {
    return;
  }

  await invalidateCustomDomainBeforeRemoval(row, host);
  await synchronizeEdgeAppAccessState();
}

function shouldSyncEdgeAfterCustomDomainVerification(
  row: CustomDomainRow,
  result: CustomDomainDnsVerificationResult,
): boolean {
  return wasEverVerifiedCustomDomainRow(row) || isVerifiedCustomDomainResult(result);
}

async function invalidateCustomDomainBeforeRemoval(row: CustomDomainRow, host: string): Promise<void> {
  const now: Date = new Date();
  await updateCustomDomainCheck({
    failureMessage: 'Custom domain removal is pending edge synchronization.',
    host,
    id: row.id,
    lastCheckedAt: row.lastCheckedAt,
    ownershipStatus: 'invalid',
    routingStatus: 'invalid',
    updatedAt: now,
    verifiedAt: readCustomDomainRemovalVerifiedAt(row, now),
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

function readCustomDomainRemovalVerifiedAt(row: CustomDomainRow, now: Date): Date | null {
  if (row.verifiedAt !== null) {
    return row.verifiedAt;
  }

  return isVerifiedCustomDomainRow(row) ? now : null;
}

function wasEverVerifiedCustomDomainRow(row: CustomDomainRow): boolean {
  return row.verifiedAt !== null || isVerifiedCustomDomainRow(row);
}

function isVerifiedCustomDomainRow(row: CustomDomainRow): boolean {
  return row.ownershipStatus === 'valid' && row.routingStatus === 'valid';
}

function isVerifiedCustomDomainResult(result: CustomDomainDnsVerificationResult): boolean {
  return result.ownershipStatus === 'valid' && result.routingStatus === 'valid';
}

import {
  buildControlPlaneHost,
  buildDomainWildcardHost,
  type DomainDnsRecord,
  type IssuePasswordResetResponse,
  type SystemDomainMutationResponse,
  type SystemDomainPendingOperation,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';

export function createSystemDomainMutationMessage(result: SystemDomainMutationResponse): string {
  return createSystemDomainStatusMessage(result.status);
}

export function createSystemDomainStatusMessage(result: SystemDomainStatusResponse): string {
  const lines: string[] = [
    `Active domain: ${buildControlPlaneHost(result.active.baseDomain)}; apps ${buildDomainWildcardHost(result.active.baseDomain)}.`,
    `TLS mode: ${result.active.tlsMode}; public scheme: ${result.active.publicScheme}.`,
    `Health: ${result.activeDomainHealth.status}.`,
    `Setup version: ${result.setupVersion.toString()}.`,
  ];
  if (result.activeDomainHealth.failureMessage !== null) {
    lines.push(`Last error: ${result.activeDomainHealth.failureMessage}`);
  }
  if (result.pending !== null) {
    lines.push(...createPendingDomainLines(result.pending));
  }
  return lines.join('\n');
}

export function createIssuePasswordResetMessage(result: IssuePasswordResetResponse): string {
  return `Issued a one-time password reset for ${result.email}.
Reset token: ${result.resetToken}
Reset URL: ${result.resetUrl}
Expires at: ${result.expiresAt}.`;
}

function createPendingDomainLines(pending: SystemDomainPendingOperation): string[] {
  const lines: string[] = [
    `Pending domain: ${buildControlPlaneHost(pending.hostPlan.baseDomain)}; apps ${buildDomainWildcardHost(pending.hostPlan.baseDomain)}; status ${pending.status}.`,
    ...pending.requiredDnsRecords.map(formatDnsRecord),
  ];
  if (pending.failureMessage !== null) {
    lines.push(`Last verify error: ${pending.failureMessage}`);
  }
  if (pending.certificate !== null) {
    lines.push(`Certificate expires at ${pending.certificate.metadata.expiresAt}.`);
  }
  return lines;
}

function formatDnsRecord(record: DomainDnsRecord): string {
  return `- ${record.recordType} ${record.name} -> ${record.value}${record.required ? '' : ' (provider-specific alternative)'}`;
}

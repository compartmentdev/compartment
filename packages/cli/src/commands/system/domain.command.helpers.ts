import {
  buildControlPlaneHost,
  buildDomainWildcardHost,
  type DomainDnsRecord,
  type DomainPublicScheme,
  type SystemDomainMutationResponse,
  type SystemDomainPendingOperation,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';

export function readSystemDomainPublicScheme(value: string | undefined): DomainPublicScheme {
  if (value === undefined || value === 'https') {
    return 'https';
  }
  if (value === 'http') {
    return 'http';
  }

  throw new Error('Expected --public-scheme to be http or https.');
}

export function readSystemDomainTlsMode(value: string | undefined): 'custom-cert' | 'external' {
  if (value === undefined || value === 'external') {
    return 'external';
  }
  if (value === 'custom-cert') {
    return 'custom-cert';
  }

  throw new Error('Expected --tls to be external or custom-cert.');
}

export function readExpectedDomainSetupVersion(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (/^\d+$/u.test(value)) {
    return Number(value);
  }

  throw new Error('Expected --expected-version to be a non-negative integer.');
}

export function createSystemDomainMutationMessage(result: SystemDomainMutationResponse): string {
  return createSystemDomainStatusMessage(result.status);
}

export function createSystemDomainStatusMessage(result: SystemDomainStatusResponse): string {
  const lines: string[] = [
    `Active domain: ${buildControlPlaneHost(result.active.baseDomain)}; apps ${buildDomainWildcardHost(result.active.baseDomain)}.`,
    `TLS mode: ${result.active.tlsMode}; Caddy mode: ${result.active.caddyMode}; public scheme: ${result.active.publicScheme}.`,
    `Health: ${result.activeDomainHealth.status}.`,
    ...renderActiveHealthLines(result),
    `Setup version: ${result.setupVersion.toString()}.`,
  ];

  if (result.pending !== null) {
    lines.push(...renderPendingOperationLines(result.pending));
  }

  return lines.join('\n');
}

function renderPendingOperationLines(pending: SystemDomainPendingOperation): string[] {
  const lines: string[] = [
    `Pending domain: ${buildControlPlaneHost(pending.hostPlan.baseDomain)}; apps ${buildDomainWildcardHost(pending.hostPlan.baseDomain)}; status ${pending.status}.`,
    ...renderDnsRecordLines(pending.requiredDnsRecords),
  ];
  if (pending.status === 'verified') {
    lines.push('Ownership and install binding are verified. Run activate, then status to verify browser traffic.');
  }
  if (pending.failureMessage !== null) {
    lines.push(`Last verify error: ${pending.failureMessage}`);
  }
  if (pending.certificate !== null) {
    lines.push(`Certificate expires at ${pending.certificate.metadata.expiresAt}.`);
  }

  return lines;
}

function renderActiveHealthLines(result: SystemDomainStatusResponse): string[] {
  const failureMessage: string | null = result.activeDomainHealth.failureMessage;
  const errorLine: string[] = failureMessage === null ? [] : [`Last error: ${failureMessage}`];

  return [...renderDnsAndTransportHealthLines(result), ...renderActiveCertificateLine(result), ...errorLine];
}

function renderDnsAndTransportHealthLines(result: SystemDomainStatusResponse): string[] {
  if (result.activeDomainHealth.status === 'ok') {
    return ['DNS: ok.', `${result.active.publicScheme.toUpperCase()}: ok.`];
  }

  const failureCode: string | null = result.activeDomainHealth.failureCode;
  if (failureCode === 'dns_unresolved') {
    return ['DNS: failed.', `${result.active.publicScheme.toUpperCase()}: not checked because DNS failed.`];
  }
  if (failureCode === 'probe_failed' || failureCode === 'probe_unreachable') {
    return ['DNS: ok.', `${result.active.publicScheme.toUpperCase()}: failed.`];
  }
  if (failureCode === 'edge_sync_failed') {
    return ['DNS: ok.', `${result.active.publicScheme.toUpperCase()}: ok.`];
  }

  return ['DNS: not checked.', `${result.active.publicScheme.toUpperCase()}: not checked.`];
}

function renderActiveCertificateLine(result: SystemDomainStatusResponse): string[] {
  if (result.active.tlsMode !== 'custom-cert') {
    return [];
  }
  if (result.activeDomainHealth.status === 'ok') {
    return ['Certificate: accepted by HTTPS probe.'];
  }
  if (result.activeDomainHealth.failureCode === 'dns_unresolved') {
    return ['Certificate: not checked because DNS failed.'];
  }
  if (
    result.activeDomainHealth.failureCode === 'probe_failed' ||
    result.activeDomainHealth.failureCode === 'probe_unreachable'
  ) {
    return ['Certificate: not accepted or origin unreachable.'];
  }
  if (result.activeDomainHealth.failureCode === 'edge_sync_failed') {
    return ['Certificate: accepted by HTTPS probe.'];
  }

  return ['Certificate: not checked.'];
}

function renderDnsRecordLines(records: DomainDnsRecord[]): string[] {
  if (records.length === 0) {
    return [];
  }

  return ['DNS records:', ...records.map(formatDnsRecord)];
}

function formatDnsRecord(record: DomainDnsRecord): string {
  const requiredSuffix: string = record.required ? '' : ' (provider-specific alternative)';
  if (record.recordType === 'APEX_ALIAS') {
    return `- Root domain ${record.name} -> ${record.value}${requiredSuffix}; ${record.purpose}.`;
  }

  return `- ${record.recordType} ${record.name} -> ${record.value}${requiredSuffix}; ${record.purpose}.`;
}

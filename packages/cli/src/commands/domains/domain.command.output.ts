import type {
  CreateCustomDomainResponse,
  CustomDomainDnsRecord,
  CustomDomainResponse,
  CustomDomainSummary,
  ListCustomDomainsResponse,
  RemoveCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@compartment/contracts';

export function createCustomDomainAddMessage(response: CreateCustomDomainResponse): string {
  return renderMultilineText([
    `Custom domain ${response.domain.host} is ${response.domain.status}.`,
    '',
    'DNS records:',
    ...response.dnsRecords.map(formatDnsRecord),
    '',
    `Run compartment domain verify ${response.domain.host} after DNS propagates.`,
  ]);
}

export function createCustomDomainVerifyMessage(response: VerifyCustomDomainResponse): string {
  return renderMultilineText([
    `Custom domain ${response.domain.host} is ${response.domain.status}.`,
    `Ownership: ${response.domain.ownershipStatus}`,
    `Routing: ${response.domain.routingStatus}`,
    ...(response.domain.failureMessage === null ? [] : [response.domain.failureMessage]),
  ]);
}

export function createCustomDomainShowMessage(response: CustomDomainResponse): string {
  return formatDomainSummary(response.domain);
}

export function createCustomDomainListMessage(response: ListCustomDomainsResponse): string {
  if (response.domains.length === 0) {
    return 'No custom domains found.';
  }

  return response.domains.map(formatDomainSummary).join('\n\n');
}

export function createCustomDomainRemoveMessage(response: RemoveCustomDomainResponse): string {
  return `Removed custom domain ${response.host}.`;
}

function formatDomainSummary(domain: CustomDomainSummary): string {
  return renderMultilineText([
    `${domain.host} (${domain.status})`,
    `Project: ${domain.projectName}`,
    `Environment: ${domain.environmentName}`,
    `Service: ${domain.serviceName}`,
    `Canonical route: ${domain.canonicalRouteHost}`,
    `Ownership: ${domain.ownershipStatus}`,
    `Routing: ${domain.routingStatus}`,
    ...(domain.failureMessage === null ? [] : [`Failure: ${domain.failureMessage}`]),
  ]);
}

function formatDnsRecord(record: CustomDomainDnsRecord): string {
  if (record.recordType === 'APEX_ALIAS') {
    return `- Root domain ${record.name} -> ${record.value} (Cloudflare: CNAME @, DNS only; others: ALIAS/ANAME)`;
  }

  const requiredSuffix: string = record.required ? '' : ' (provider-specific alternative)';

  return `- ${record.recordType} ${record.name} -> ${record.value}${requiredSuffix}`;
}

function renderMultilineText(lines: string[]): string {
  return lines.join('\n');
}

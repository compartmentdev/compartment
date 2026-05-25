import { isIP } from 'node:net';
import { isUnsafePublicIpAddress } from '../public-ip';
import { defaultOutboundDnsResolver } from './outbound-http-dns';
import { OutboundHttpPolicyError } from './outbound-http-error';
import type {
  CreateOutboundHttpFetchInput,
  NormalizedOutboundHttpPolicy,
  OutboundHttpProtocol,
} from './outbound-http-client.types';

const defaultMaxRedirects: number = 5;
const defaultMaxResponseBytes: number = 16 * 1024 * 1024;

export function normalizeOutboundHttpPolicy(input: CreateOutboundHttpFetchInput): NormalizedOutboundHttpPolicy {
  return {
    addressPolicy: input.addressPolicy,
    allowedProtocols: new Set<OutboundHttpProtocol>(input.allowedProtocols),
    dnsResolver: input.dnsResolver ?? defaultOutboundDnsResolver,
    maxResponseBytes: input.maxResponseBytes === undefined ? defaultMaxResponseBytes : input.maxResponseBytes,
    maxRedirects: input.maxRedirects ?? defaultMaxRedirects,
    timeoutMs: input.timeoutMs ?? null,
    trustedHosts:
      input.trustedHosts === undefined ? null : new Set<string>(input.trustedHosts.map(normalizeOutboundTrustedHost)),
  };
}

export function assertOutboundHttpUrlAllowed(url: URL, policy: NormalizedOutboundHttpPolicy): void {
  if (!policy.allowedProtocols.has(url.protocol as OutboundHttpProtocol)) {
    throw new OutboundHttpPolicyError(`Outbound HTTP protocol ${url.protocol} is not allowed.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new OutboundHttpPolicyError('Outbound HTTP URLs must not include credentials.');
  }
  if (policy.trustedHosts !== null && !policy.trustedHosts.has(normalizeOutboundTrustedHost(url.host))) {
    throw new OutboundHttpPolicyError(`Outbound HTTP target host ${url.host} is not trusted.`);
  }
  if (policy.addressPolicy === 'public') {
    assertDirectIpAddressAllowed(url);
  }
}

export function normalizeOutboundTrustedHost(value: string): string {
  return value.trim().toLowerCase();
}

function assertDirectIpAddressAllowed(url: URL): void {
  const hostname: string = normalizeDnsHostname(url.hostname);
  if (isIP(hostname) === 0) {
    return;
  }
  if (isUnsafePublicIpAddress(hostname)) {
    throw new OutboundHttpPolicyError(`Outbound HTTP target ${url.host} resolves to unsafe address ${hostname}.`);
  }
}

export function normalizeDnsHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1).toLowerCase();
  }

  return hostname.toLowerCase();
}

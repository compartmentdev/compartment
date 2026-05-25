export type OutboundHttpAddressPolicy = 'internal' | 'public';
export type OutboundHttpProtocol = 'http:' | 'https:';
export type OutboundHttpRequestRedirect = 'error' | 'follow' | 'manual';
export type OutboundHttpResource = Request | string | URL;

export interface OutboundDnsLookupAddress {
  address: string;
  family: 4 | 6;
}

export interface OutboundDnsResolver {
  lookup(hostname: string): Promise<OutboundDnsLookupAddress[]>;
}

export interface CreateOutboundHttpFetchInput {
  addressPolicy: OutboundHttpAddressPolicy;
  allowedProtocols: readonly OutboundHttpProtocol[];
  dnsResolver?: OutboundDnsResolver | undefined;
  maxResponseBytes?: number | null | undefined;
  maxRedirects?: number | undefined;
  timeoutMs?: number | undefined;
  trustedHosts?: readonly string[] | undefined;
}

export interface NormalizedOutboundHttpPolicy {
  addressPolicy: OutboundHttpAddressPolicy;
  allowedProtocols: ReadonlySet<OutboundHttpProtocol>;
  dnsResolver: OutboundDnsResolver;
  maxResponseBytes: number | null;
  maxRedirects: number;
  timeoutMs: number | null;
  trustedHosts: ReadonlySet<string> | null;
}

export interface NormalizedOutboundHttpRequest {
  body?: Buffer | string | undefined;
  headers: Headers;
  method: string;
  redirect: OutboundHttpRequestRedirect;
  signal?: AbortSignal | null | undefined;
}

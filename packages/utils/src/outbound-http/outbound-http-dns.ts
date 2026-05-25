import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as lookupDns } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { isUnsafePublicIpAddress } from '../public-ip';
import type {
  NormalizedOutboundHttpPolicy,
  OutboundDnsLookupAddress,
  OutboundDnsResolver,
} from './outbound-http-client.types';
import { OutboundHttpPolicyError } from './outbound-http-error';
import { normalizeDnsHostname } from './outbound-http-policy';

type LookupPreferredFamily = number | 'IPv4' | 'IPv6' | undefined;
type NodeLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export function createPublicOutboundLookup(policy: NormalizedOutboundHttpPolicy): LookupFunction {
  return (hostname: string, options: LookupOptions, callback: NodeLookupCallback): void => {
    const preferredFamily: number | undefined = readLookupPreferredFamily(options.family);
    const all: boolean = options.all === true;
    void resolvePublicOutboundAddresses(hostname, policy)
      .then((addresses: OutboundDnsLookupAddress[]): void => {
        if (all) {
          callback(null, buildLookupAddresses(selectResolvedAddresses(addresses, preferredFamily)));
          return;
        }

        const address: OutboundDnsLookupAddress = selectResolvedAddress(addresses, preferredFamily);
        callback(null, address.address, address.family);
      })
      .catch((error: Error | string): void => {
        callbackLookupError(callback, all, error);
      });
  };
}

class DefaultOutboundDnsResolver implements OutboundDnsResolver {
  public async lookup(hostname: string): Promise<OutboundDnsLookupAddress[]> {
    const normalizedHostname: string = normalizeDnsHostname(hostname);
    const ipVersion: number = isIP(normalizedHostname);
    if (ipVersion === 4 || ipVersion === 6) {
      return [{ address: normalizedHostname, family: ipVersion }];
    }

    return (await lookupDns(normalizedHostname, { all: true, verbatim: true })).map(
      (address: LookupAddress): OutboundDnsLookupAddress => ({
        address: address.address,
        family: readLookupAddressFamily(address.family),
      }),
    );
  }
}

export const defaultOutboundDnsResolver: OutboundDnsResolver = new DefaultOutboundDnsResolver();

async function resolvePublicOutboundAddresses(
  hostname: string,
  policy: NormalizedOutboundHttpPolicy,
): Promise<OutboundDnsLookupAddress[]> {
  const addresses: OutboundDnsLookupAddress[] = await policy.dnsResolver.lookup(normalizeDnsHostname(hostname));
  assertResolvedAddressesSafe(hostname, addresses);

  return addresses;
}

function assertResolvedAddressesSafe(hostname: string, addresses: readonly OutboundDnsLookupAddress[]): void {
  const unsafeAddress: OutboundDnsLookupAddress | undefined = addresses.find(
    (address: OutboundDnsLookupAddress): boolean => isUnsafePublicIpAddress(address.address),
  );
  if (addresses.length === 0) {
    throw new OutboundHttpPolicyError(`Outbound HTTP target ${hostname} did not resolve to an address.`);
  }
  if (unsafeAddress !== undefined) {
    throw new OutboundHttpPolicyError(
      `Outbound HTTP target ${hostname} resolves to unsafe address ${unsafeAddress.address}.`,
    );
  }
}

function selectResolvedAddress(
  addresses: readonly OutboundDnsLookupAddress[],
  preferredFamily: number | undefined,
): OutboundDnsLookupAddress {
  const firstAddress: OutboundDnsLookupAddress | undefined = selectResolvedAddresses(addresses, preferredFamily)[0];
  if (firstAddress === undefined) {
    throw new OutboundHttpPolicyError('Outbound DNS resolution returned no addresses.');
  }

  return firstAddress;
}

function selectResolvedAddresses(
  addresses: readonly OutboundDnsLookupAddress[],
  preferredFamily: number | undefined,
): readonly OutboundDnsLookupAddress[] {
  if (preferredFamily !== 4 && preferredFamily !== 6) {
    return addresses;
  }

  const preferredAddresses: OutboundDnsLookupAddress[] = addresses.filter(
    (address: OutboundDnsLookupAddress): boolean => address.family === preferredFamily,
  );
  return preferredAddresses.length > 0 ? preferredAddresses : addresses;
}

function buildLookupAddresses(addresses: readonly OutboundDnsLookupAddress[]): LookupAddress[] {
  return addresses.map(
    (address: OutboundDnsLookupAddress): LookupAddress => ({
      address: address.address,
      family: address.family,
    }),
  );
}

function callbackLookupError(callback: NodeLookupCallback, all: boolean, error: Error | string): void {
  const lookupError: Error = error instanceof Error ? error : new Error('Outbound DNS resolution failed.');
  if (all) {
    callback(lookupError, []);
    return;
  }

  callback(lookupError, '', 4);
}

function readLookupPreferredFamily(family: LookupPreferredFamily): number | undefined {
  if (family === 4 || family === 6) {
    return family;
  }
  if (family === 'IPv4') {
    return 4;
  }
  if (family === 'IPv6') {
    return 6;
  }

  return undefined;
}

function readLookupAddressFamily(family: number): 4 | 6 {
  if (family === 4 || family === 6) {
    return family;
  }

  throw new OutboundHttpPolicyError(`Outbound DNS returned unsupported address family ${family.toString()}.`);
}

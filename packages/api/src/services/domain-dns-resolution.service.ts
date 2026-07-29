import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import { normalizeDnsHostname } from '@compartment/utils';

export async function resolveTxtValues(host: string): Promise<string[]> {
  try {
    return (await resolveTxt(host)).map((segments: string[]): string => segments.join(''));
  } catch {
    return [];
  }
}

export async function resolveCnameRecords(host: string): Promise<string[]> {
  try {
    return (await resolveCname(host)).map(normalizeDnsHostname);
  } catch {
    return [];
  }
}

export async function resolveAddressRecords(host: string, version: 4 | 6): Promise<string[]> {
  try {
    return version === 4 ? await resolve4(host) : await resolve6(host);
  } catch {
    return [];
  }
}

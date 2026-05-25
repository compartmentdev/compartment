import { describe, expect, it } from 'vitest';
import { isUnsafePublicIpAddress } from '../src';

describe('public IP helpers', (): void => {
  it('accepts IPv4 and IPv6 literals outside the blocked unsafe ranges', (): void => {
    expect(isUnsafePublicIpAddress(buildIpv4Address([8, 8, 8, 8]))).toBe(false);
    expect(isUnsafePublicIpAddress(buildIpv6Address(['2606', '4700', '4700', '0', '0', '0', '0', '1111']))).toBe(false);
  });

  it('rejects unsafe IPv4 ranges', (): void => {
    expect(isUnsafePublicIpAddress('127.0.0.1')).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([10, 0, 0, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([172, 16, 0, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([192, 168, 0, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([169, 254, 1, 1]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([192, 0, 2, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([198, 18, 0, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([198, 51, 100, 10]))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4Address([203, 0, 113, 10]))).toBe(true);
  });

  it('rejects unsafe IPv6 ranges and malformed input', (): void => {
    expect(isUnsafePublicIpAddress('::')).toBe(true);
    expect(isUnsafePublicIpAddress('::1')).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv4MappedIpv6Address(buildIpv4Address([127, 0, 0, 1])))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv6Address(['2001', 'db8', '0', '0', '0', '0', '0', '10']))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv6Address(['fc00', '0', '0', '0', '0', '0', '0', '1']))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv6Address(['fe80', '0', '0', '0', '0', '0', '0', '1']))).toBe(true);
    expect(isUnsafePublicIpAddress(buildIpv6Address(['ff00', '0', '0', '0', '0', '0', '0', '1']))).toBe(true);
    expect(isUnsafePublicIpAddress('not-an-ip')).toBe(true);
  });
});

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv6Address(segments: readonly [string, string, string, string, string, string, string, string]): string {
  return segments.join(':');
}

function buildIpv4MappedIpv6Address(ipv4Address: string): string {
  return `::ffff:${ipv4Address}`;
}

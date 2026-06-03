import type { RuntimeNetworkPoolConfig } from '../src/services/runtime.types';

export function createRuntimeNetworkPoolConfig(
  overrides: Partial<RuntimeNetworkPoolConfig> = {},
): RuntimeNetworkPoolConfig {
  return {
    cidr: buildTestIpv4Cidr(10, 240, 0, 0, 24),
    subnetPrefixLength: 28,
    ...overrides,
  };
}

export function buildTestIpv4Cidr(
  first: number,
  second: number,
  third: number,
  fourth: number,
  prefixLength: number,
): string {
  return `${buildTestIpv4Address(first, second, third, fourth)}/${prefixLength.toString()}`;
}

export function buildTestIpv4Address(first: number, second: number, third: number, fourth: number): string {
  return `${first.toString()}.${second.toString()}.${third.toString()}.${fourth.toString()}`;
}

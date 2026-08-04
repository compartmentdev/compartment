interface Ipv4Range {
  network: number;
  prefix: number;
}

const reservedIpv4Ranges: readonly Ipv4Range[] = [
  createIpv4Range([0, 0, 0, 0], 8),
  createIpv4Range([10, 0, 0, 0], 8),
  createIpv4Range([100, 64, 0, 0], 10),
  createIpv4Range([127, 0, 0, 0], 8),
  createIpv4Range([169, 254, 0, 0], 16),
  createIpv4Range([172, 16, 0, 0], 12),
  createIpv4Range([192, 0, 0, 0], 24),
  createIpv4Range([192, 0, 2, 0], 24),
  createIpv4Range([192, 88, 99, 0], 24),
  createIpv4Range([192, 168, 0, 0], 16),
  createIpv4Range([198, 18, 0, 0], 15),
  createIpv4Range([198, 51, 100, 0], 24),
  createIpv4Range([203, 0, 113, 0], 24),
  createIpv4Range([224, 0, 0, 0], 4),
  createIpv4Range([240, 0, 0, 0], 4),
];

export function areIpv4CidrsOverlapping(left: string, right: string): boolean {
  const leftCidr: Ipv4Range | undefined = parseCidr(left);
  const rightCidr: Ipv4Range | undefined = parseCidr(right);
  if (leftCidr === undefined || rightCidr === undefined) {
    return false;
  }
  const mask: number = prefixMask(Math.min(leftCidr.prefix, rightCidr.prefix));
  return (leftCidr.network & mask) === (rightCidr.network & mask);
}

export function isGloballyRoutableIpv4(value: string): boolean {
  const address: number | undefined = parseIpv4(value);
  return (
    address !== undefined &&
    !reservedIpv4Ranges.some((range: Ipv4Range): boolean => (address & prefixMask(range.prefix)) === range.network)
  );
}

function parseCidr(value: string): Ipv4Range | undefined {
  const [addressValue, prefixValue, extra]: string[] = value.split('/');
  const address: number | undefined = addressValue === undefined ? undefined : parseIpv4(addressValue);
  const prefix: number = Number(prefixValue);
  return extra === undefined && address !== undefined && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
    ? { network: address & prefixMask(prefix), prefix }
    : undefined;
}

function parseIpv4(value: string): number | undefined {
  const parts: number[] = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part: number): boolean => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return ipv4PartsToNumber(parts);
}

function createIpv4Range(parts: readonly number[], prefix: number): Ipv4Range {
  return { network: ipv4PartsToNumber(parts) & prefixMask(prefix), prefix };
}

function ipv4PartsToNumber(parts: readonly number[]): number {
  return parts.reduce((address: number, part: number): number => ((address << 8) | part) >>> 0, 0);
}

function prefixMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

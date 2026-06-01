export interface Ipv4Cidr {
  address: number;
  prefixLength: number;
}

export function cidrsOverlap(left: Ipv4Cidr, right: Ipv4Cidr): boolean {
  return readIpv4CidrStart(left) <= readIpv4CidrEnd(right) && readIpv4CidrStart(right) <= readIpv4CidrEnd(left);
}

export function cidrContainsCidr(container: Ipv4Cidr, contained: Ipv4Cidr): boolean {
  return (
    readIpv4CidrStart(container) <= readIpv4CidrStart(contained) &&
    readIpv4CidrEnd(container) >= readIpv4CidrEnd(contained)
  );
}

export function* enumerateIpv4Subnets(pool: Ipv4Cidr, subnetPrefixLength: number): Generator<Ipv4Cidr> {
  if (subnetPrefixLength < pool.prefixLength || subnetPrefixLength > 30) {
    throw new Error(
      `Runtime network subnet prefix must be between ${pool.prefixLength.toString()} and 30 for pool ${formatIpv4Cidr(pool)}.`,
    );
  }

  const subnetSize: number = readIpv4BlockSize(subnetPrefixLength);
  for (let address: number = readIpv4CidrStart(pool); address <= readIpv4CidrEnd(pool); address += subnetSize) {
    yield {
      address,
      prefixLength: subnetPrefixLength,
    };
  }
}

export function parseIpv4RouteCidrs(output: string): Ipv4Cidr[] {
  return output
    .split(/\r?\n/u)
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line !== '')
    .flatMap(parseIpv4RouteCidrLine);
}

function parseIpv4RouteCidrLine(line: string): Ipv4Cidr[] {
  const routeTarget: string | undefined = readIpv4RouteTarget(line);
  if (routeTarget === undefined || routeTarget === 'default') {
    return [];
  }

  return [parseIpv4Cidr(routeTarget.includes('/') ? routeTarget : `${routeTarget}/32`)];
}

function readIpv4RouteTarget(line: string): string | undefined {
  const parts: string[] = line.split(/\s+/u);
  const [first, second] = parts;
  if (first === undefined) {
    return undefined;
  }

  if (isIpv4RouteTypePrefix(first)) {
    return second;
  }

  return first;
}

function isIpv4RouteTypePrefix(value: string): boolean {
  return value === 'blackhole' || value === 'prohibit' || value === 'throw' || value === 'unreachable';
}

export function parseIpv4Cidr(value: string): Ipv4Cidr {
  const [addressText, prefixText, extra] = value.split('/');
  if (addressText === undefined || prefixText === undefined || extra !== undefined) {
    throw new Error(`Invalid IPv4 CIDR ${value}.`);
  }

  const prefixLength: number = Number(prefixText);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Invalid IPv4 CIDR prefix ${prefixText}.`);
  }

  return {
    address: normalizeIpv4NetworkAddress(parseIpv4Address(addressText), prefixLength),
    prefixLength,
  };
}

export function formatIpv4Cidr(cidr: Ipv4Cidr): string {
  return `${formatIpv4Address(cidr.address)}/${cidr.prefixLength.toString()}`;
}

export function readIpv4CidrAddressCount(cidr: Ipv4Cidr): number {
  return readIpv4BlockSize(cidr.prefixLength);
}

function parseIpv4Address(value: string): number {
  const octets: string[] = value.split('.');
  if (octets.length !== 4) {
    throw new Error(`Invalid IPv4 address ${value}.`);
  }

  return octets.reduce((address: number, octetText: string): number => {
    const octet: number = Number(octetText);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255 || octetText.trim() !== octet.toString()) {
      throw new Error(`Invalid IPv4 address ${value}.`);
    }

    return address * 256 + octet;
  }, 0);
}

function formatIpv4Address(address: number): string {
  return [
    Math.floor(address / 16_777_216) % 256,
    Math.floor(address / 65_536) % 256,
    Math.floor(address / 256) % 256,
    address % 256,
  ].join('.');
}

function normalizeIpv4NetworkAddress(address: number, prefixLength: number): number {
  const blockSize: number = readIpv4BlockSize(prefixLength);
  return Math.floor(address / blockSize) * blockSize;
}

function readIpv4CidrStart(cidr: Ipv4Cidr): number {
  return cidr.address;
}

function readIpv4CidrEnd(cidr: Ipv4Cidr): number {
  return cidr.address + readIpv4BlockSize(cidr.prefixLength) - 1;
}

function readIpv4BlockSize(prefixLength: number): number {
  return 2 ** (32 - prefixLength);
}

import { BlockList, isIP } from 'node:net';

const unsafeIpv4Addresses: BlockList = createUnsafeIpv4Addresses();
const unsafeIpv6Addresses: BlockList = createUnsafeIpv6Addresses();

export function isUnsafePublicIpAddress(address: string): boolean {
  const ipVersion: number = isIP(address);
  if (ipVersion === 4) {
    return unsafeIpv4Addresses.check(address, 'ipv4');
  }
  if (ipVersion === 6) {
    return unsafeIpv6Addresses.check(address, 'ipv6');
  }

  return true;
}

function createUnsafeIpv4Addresses(): BlockList {
  const blockList: BlockList = new BlockList();
  blockList.addSubnet(buildIpv4Address([0, 0, 0, 0]), 8, 'ipv4');
  blockList.addSubnet(buildIpv4Address([10, 0, 0, 0]), 8, 'ipv4');
  blockList.addSubnet(buildIpv4Address([100, 64, 0, 0]), 10, 'ipv4');
  blockList.addSubnet(buildIpv4Address([127, 0, 0, 0]), 8, 'ipv4');
  blockList.addSubnet(buildIpv4Address([169, 254, 0, 0]), 16, 'ipv4');
  blockList.addSubnet(buildIpv4Address([172, 16, 0, 0]), 12, 'ipv4');
  blockList.addSubnet(buildIpv4Address([192, 168, 0, 0]), 16, 'ipv4');
  addUnsafeIpv4DocumentationAndBenchmarkAddresses(blockList);
  blockList.addSubnet(buildIpv4Address([224, 0, 0, 0]), 4, 'ipv4');
  blockList.addSubnet(buildIpv4Address([240, 0, 0, 0]), 4, 'ipv4');

  return blockList;
}

function addUnsafeIpv4DocumentationAndBenchmarkAddresses(blockList: BlockList): void {
  blockList.addSubnet(buildIpv4Address([192, 0, 2, 0]), 24, 'ipv4');
  blockList.addSubnet(buildIpv4Address([198, 18, 0, 0]), 15, 'ipv4');
  blockList.addSubnet(buildIpv4Address([198, 51, 100, 0]), 24, 'ipv4');
  blockList.addSubnet(buildIpv4Address([203, 0, 113, 0]), 24, 'ipv4');
}

function createUnsafeIpv6Addresses(): BlockList {
  const blockList: BlockList = new BlockList();
  blockList.addAddress(buildIpv6Address(['0', '0', '0', '0', '0', '0', '0', '0']), 'ipv6');
  blockList.addAddress(buildIpv6Address(['0', '0', '0', '0', '0', '0', '0', '1']), 'ipv6');
  blockList.addSubnet(buildIpv6Address(['0', '0', '0', '0', '0', 'ffff', '0', '0']), 96, 'ipv6');
  blockList.addSubnet(buildIpv6Address(['2001', 'db8', '0', '0', '0', '0', '0', '0']), 32, 'ipv6');
  blockList.addSubnet(buildIpv6Address(['fc00', '0', '0', '0', '0', '0', '0', '0']), 7, 'ipv6');
  blockList.addSubnet(buildIpv6Address(['fe80', '0', '0', '0', '0', '0', '0', '0']), 10, 'ipv6');
  blockList.addSubnet(buildIpv6Address(['ff00', '0', '0', '0', '0', '0', '0', '0']), 8, 'ipv6');

  return blockList;
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv6Address(segments: readonly [string, string, string, string, string, string, string, string]): string {
  return segments.join(':');
}

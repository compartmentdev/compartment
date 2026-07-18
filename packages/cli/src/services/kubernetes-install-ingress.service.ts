import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { isUnsafePublicIpAddress } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type {
  KubernetesPublicIngress,
  KubernetesPublicIngressResolutionInput,
  KubernetesServiceAddress,
  KubernetesServiceList,
  KubernetesServiceListItem,
} from './kubernetes-install.service.types';

const loadBalancerPollIntervalMs: number = 2_000;
const loadBalancerWaitTimeoutMs: number = 15 * 60_000;

export async function resolveKubernetesPublicIngress(
  input: KubernetesPublicIngressResolutionInput,
): Promise<KubernetesPublicIngress> {
  const configuredIngress: KubernetesPublicIngress = validateConfiguredPublicIngress(input);
  if (configuredIngress.publicIngressIpv4 !== '' || configuredIngress.publicIngressIpv6 !== '') {
    return configuredIngress;
  }

  return await waitForLoadBalancerPublicIngress(input);
}

async function waitForLoadBalancerPublicIngress(
  input: KubernetesPublicIngressResolutionInput,
): Promise<KubernetesPublicIngress> {
  const deadline: number = Date.now() + loadBalancerWaitTimeoutMs;
  while (Date.now() < deadline) {
    const service: KubernetesServiceListItem = await readCaddyService(input);
    if (service.spec?.type !== 'LoadBalancer') {
      throw new Error(
        'Public ingress addresses are required when the Caddy Service is not a LoadBalancer. Set platform.publicIngressIpv4 or platform.publicIngressIpv6.',
      );
    }
    const resolvedIngress: KubernetesPublicIngress | null = await resolveLoadBalancerIngress(
      service.status?.loadBalancer?.ingress ?? [],
    );
    if (resolvedIngress !== null) {
      return resolvedIngress;
    }
    await sleep(loadBalancerPollIntervalMs);
  }

  throw new Error('Timed out waiting for the Caddy LoadBalancer Service to publish a public address.');
}

async function readCaddyService(input: KubernetesPublicIngressResolutionInput): Promise<KubernetesServiceListItem> {
  const command: string[] = buildKubectlCommand(input, [
    'get',
    'service',
    '--selector',
    `app.kubernetes.io/instance=${input.releaseName},app.kubernetes.io/component=caddy`,
    '--output',
    'json',
  ]);
  const result: CommandResult = await runCommand(command);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to inspect the Caddy Service: ${readCommandOutput(result)}`);
  }
  const list: KubernetesServiceList = parseServiceList(result.stdout);
  if (list.items.length !== 1 || list.items[0] === undefined) {
    throw new Error('Expected exactly one Caddy Service for the Helm release.');
  }
  return list.items[0];
}

function parseServiceList(output: string): KubernetesServiceList {
  try {
    const value: KubernetesServiceList = JSON.parse(output) as KubernetesServiceList;
    if (Array.isArray(value.items)) {
      return value;
    }
  } catch {
    // The shared error below is intentionally stable for malformed kubectl output.
  }
  throw new Error('kubectl returned an invalid Caddy Service response.');
}

async function resolveLoadBalancerIngress(
  addresses: readonly KubernetesServiceAddress[],
): Promise<KubernetesPublicIngress | null> {
  const candidates: string[] = [];
  for (const address of addresses) {
    candidates.push(...(await resolveLoadBalancerAddress(address)));
  }
  const publicAddresses: string[] = [...new Set(candidates)]
    .filter((candidate: string): boolean => !isUnsafePublicIpAddress(candidate))
    .sort((left: string, right: string): number => left.localeCompare(right, 'en'));
  if (publicAddresses.length === 0) {
    return null;
  }
  return {
    publicIngressIpv4: publicAddresses.find((candidate: string): boolean => isIP(candidate) === 4) ?? '',
    publicIngressIpv6: publicAddresses.find((candidate: string): boolean => isIP(candidate) === 6) ?? '',
  };
}

async function resolveLoadBalancerAddress(address: KubernetesServiceAddress): Promise<string[]> {
  if (address.ip !== undefined) {
    return [address.ip];
  }
  if (address.hostname === undefined) {
    return [];
  }
  try {
    const resolvedAddresses: LookupAddress[] = await lookup(address.hostname, { all: true, verbatim: true });
    return resolvedAddresses.map((resolvedAddress: LookupAddress): string => resolvedAddress.address);
  } catch {
    // LoadBalancer hostnames can be published before their DNS records propagate.
    return [];
  }
}

function validateConfiguredPublicIngress(input: KubernetesPublicIngress): KubernetesPublicIngress {
  assertPublicIngressAddress(input.publicIngressIpv4, 4, 'platform.publicIngressIpv4');
  assertPublicIngressAddress(input.publicIngressIpv6, 6, 'platform.publicIngressIpv6');
  return {
    publicIngressIpv4: input.publicIngressIpv4,
    publicIngressIpv6: input.publicIngressIpv6,
  };
}

function assertPublicIngressAddress(value: string, version: 4 | 6, fieldName: string): void {
  if (value === '') {
    return;
  }
  if (isIP(value) !== version || isUnsafePublicIpAddress(value)) {
    throw new Error(`${fieldName} must be empty or a public IPv${version} address.`);
  }
}

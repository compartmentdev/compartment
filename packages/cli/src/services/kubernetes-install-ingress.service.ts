import { isIP } from 'node:net';
import { isUnsafePublicIpAddress } from '@compartment/utils';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { waitForInstallDelay } from './kubernetes-install-delay.service';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type {
  KubernetesIngressAddress,
  KubernetesIngressEndpoint,
  KubernetesIngressEndpointType,
  KubernetesIngressList,
  KubernetesIngressListItem,
  KubernetesPublicIngress,
  KubernetesPublicIngressResolutionInput,
} from './kubernetes-install.service.types';

const ingressPollIntervalMs: number = 2_000;
const ingressWaitTimeoutMs: number = 5 * 60_000;
const ingressInspectionTimeoutMs: number = 15_000;

export async function resolveKubernetesPublicIngress(
  input: KubernetesPublicIngressResolutionInput,
): Promise<KubernetesPublicIngress> {
  if (input.configuredEndpoint !== null) {
    return buildPublicIngress(input.ingressClassName, [validateIngressEndpoint(input.configuredEndpoint)]);
  }

  const deadline: number = Date.now() + ingressWaitTimeoutMs;
  for (;;) {
    const endpoints: KubernetesIngressEndpoint[] = await observeIngressEndpoints(input, deadline);
    if (endpoints.length > 0) {
      return buildPublicIngress(input.ingressClassName, endpoints);
    }
    const delayMs: number = Math.min(ingressPollIntervalMs, Math.max(0, deadline - Date.now()));
    if (delayMs > 0) {
      await waitForInstallDelay(delayMs);
    }
  }
}

async function observeIngressEndpoints(
  input: KubernetesPublicIngressResolutionInput,
  deadline: number,
): Promise<KubernetesIngressEndpoint[]> {
  const remainingMs: number = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(
      'No endpoint was published in the Compartment Ingress status after 300s. Configure ingress.endpoint explicitly or fix the selected Ingress Controller, then re-run install to resume.',
    );
  }
  const ingress: KubernetesIngressListItem = await readInstallationIngress(
    input,
    Math.min(ingressInspectionTimeoutMs, remainingMs),
  );
  return readObservedEndpoints(ingress.status?.loadBalancer?.ingress ?? []);
}

async function readInstallationIngress(
  input: KubernetesPublicIngressResolutionInput,
  timeoutMs: number,
): Promise<KubernetesIngressListItem> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      '--request-timeout=10s',
      'get',
      'ingress',
      '--selector',
      `app.kubernetes.io/instance=${input.releaseName},app.kubernetes.io/component=ingress`,
      '--output',
      'json',
    ]),
    timeoutMs,
  );
  return readInstallationIngressResult(result);
}

function readInstallationIngressResult(result: CommandResult): KubernetesIngressListItem {
  if (result.exitCode !== 0) {
    if (result.exitCode === 124) {
      throw new Error(
        'Timed out inspecting the Compartment Ingress. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.',
      );
    }
    throw new Error(`Failed to inspect the Compartment Ingress: ${readCommandOutput(result)}`);
  }
  const list: KubernetesIngressList = parseIngressList(result.stdout);
  if (list.items.length !== 1 || list.items[0] === undefined) {
    throw new Error('Expected exactly one Compartment Ingress for the Helm release.');
  }
  return list.items[0];
}

function parseIngressList(output: string): KubernetesIngressList {
  try {
    const value: KubernetesIngressList = JSON.parse(output) as KubernetesIngressList;
    if (Array.isArray(value.items)) {
      return value;
    }
  } catch {
    // The shared error below is intentionally stable for malformed kubectl output.
  }
  throw new Error('kubectl returned an invalid Ingress response.');
}

function readObservedEndpoints(addresses: readonly KubernetesIngressAddress[]): KubernetesIngressEndpoint[] {
  const endpoints: KubernetesIngressEndpoint[] = addresses
    .flatMap((address: KubernetesIngressAddress): KubernetesIngressEndpoint[] => {
      if (address.ip !== undefined) {
        const version: number = isIP(address.ip);
        if (version === 4) {
          return [{ type: 'A', value: address.ip }];
        }
        return version === 6 ? [{ type: 'AAAA', value: address.ip }] : [];
      }
      return address.hostname === undefined ? [] : [{ type: 'hostname', value: normalizeHostname(address.hostname) }];
    })
    .filter((endpoint: KubernetesIngressEndpoint): boolean => endpoint.value !== '')
    .sort(compareEndpoints);
  return endpoints.filter(
    (endpoint: KubernetesIngressEndpoint, index: number): boolean =>
      index === 0 || endpoint.type !== endpoints[index - 1]?.type || endpoint.value !== endpoints[index - 1]?.value,
  );
}

function validateIngressEndpoint(endpoint: KubernetesIngressEndpoint): KubernetesIngressEndpoint {
  if (
    ((endpoint.type === 'A' && isIP(endpoint.value) === 4) ||
      (endpoint.type === 'AAAA' && isIP(endpoint.value) === 6)) &&
    !isUnsafePublicIpAddress(endpoint.value)
  ) {
    return endpoint;
  }
  if (endpoint.type === 'hostname') {
    const hostname: string = normalizeHostname(endpoint.value);
    if (
      hostname !== '' &&
      hostname.length <= 253 &&
      hostname.split('.').every((label: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    ) {
      return { type: 'hostname', value: hostname };
    }
  }
  throw new Error('ingress.endpoint must contain a public A or AAAA address, or a valid hostname.');
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/u, '');
}

function compareEndpoints(left: KubernetesIngressEndpoint, right: KubernetesIngressEndpoint): number {
  const rank: Record<KubernetesIngressEndpointType, number> = { A: 0, AAAA: 1, hostname: 2 };
  const rankDifference: number = rank[left.type] - rank[right.type];
  return rankDifference !== 0 ? rankDifference : left.value.localeCompare(right.value, 'en');
}

function buildPublicIngress(
  ingressClassName: string,
  ingressTargets: KubernetesIngressEndpoint[],
): KubernetesPublicIngress {
  const ingressEndpoint: KubernetesIngressEndpoint | undefined = ingressTargets[0];
  if (ingressEndpoint === undefined) {
    throw new Error('At least one public Ingress target is required.');
  }
  return {
    ingressClassName,
    ingressEndpoint,
    ingressTargets,
    publicIngressIpv4:
      ingressTargets.find((target: KubernetesIngressEndpoint): boolean => target.type === 'A')?.value ?? '',
    publicIngressIpv6:
      ingressTargets.find((target: KubernetesIngressEndpoint): boolean => target.type === 'AAAA')?.value ?? '',
  };
}

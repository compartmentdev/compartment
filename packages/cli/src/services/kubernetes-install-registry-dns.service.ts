import { isIP } from 'node:net';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import { readRegistryDnsProbeImage } from './kubernetes-install-registry-dns-image.service';
import { cleanupNodeDnsProbe, runNodeDnsProbe } from './kubernetes-install-registry-dns-probe.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';
import { readReadyKubernetesNodeNames } from './kubernetes-ready-nodes.service';
import type {
  RegistryDnsAnswer,
  RegistryDnsProbeOutput,
  RegistryService,
} from './kubernetes-install-registry-dns.service.types';

export class RegistryDnsResolutionError extends Error {}

export async function assertKubernetesInstallRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<void> {
  const serviceAddresses: string[] = await readRegistryServiceAddresses(input);
  const nodeNames: string[] = await readReadyKubernetesNodeNames(input);
  if (nodeNames.length === 0) {
    throw new Error('Registry DNS prerequisite found no eligible Ready nodes.');
  }
  const workerImage: string = await readRegistryDnsProbeImage(input);
  for (let index: number = 0; index < nodeNames.length; index += 1) {
    await assertNodeRegistryDns(input, state.registryHostname, serviceAddresses, workerImage, nodeNames[index]!, index);
  }
}

export async function readRegistryServiceAddresses(input: KubernetesInstallDeploymentInput): Promise<string[]> {
  const serviceName: string = `${input.releaseName}-compartment-registry-auth`;
  const result: CommandResult = await runCommand(
    buildKubectlCommand(input, [
      '--request-timeout=5s',
      'get',
      `service/${serviceName}`,
      '--namespace',
      input.namespace,
      '-o=json',
    ]),
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure('Cannot inspect the retained registry-auth Service', result));
  }
  const addresses: string[] = parseRegistryServiceAddresses(result.stdout);
  if (addresses.length === 0) {
    throw new Error(`Retained registry-auth Service ${input.namespace}/${serviceName} has no usable ClusterIP.`);
  }
  return addresses;
}

function parseRegistryServiceAddresses(output: string): string[] {
  try {
    const service: RegistryService = JSON.parse(output) as RegistryService;
    const addresses: string[] = service.spec?.clusterIPs ?? [service.spec?.clusterIP ?? ''];
    return addresses.filter((address: string): boolean => isIP(address) !== 0);
  } catch {
    throw new Error('Retained registry-auth Service inspection returned invalid JSON.');
  }
}

async function assertNodeRegistryDns(
  input: KubernetesInstallDeploymentInput,
  hostname: string,
  serviceAddresses: readonly string[],
  workerImage: string,
  nodeName: string,
  index: number,
): Promise<void> {
  const podName: string = `registry-dns-preflight-${index.toString()}`;
  let failure: Error | null = null;
  try {
    const output: RegistryDnsProbeOutput = await runNodeDnsProbe(input, podName, nodeName, workerImage, hostname);
    const observed: string[] = readDnsProbeAddresses(output, hostname, nodeName);
    assertDnsAnswers(hostname, serviceAddresses, nodeName, observed);
  } catch (error) {
    failure = error instanceof Error ? error : new Error('Registry DNS probe failed.');
    throw failure;
  } finally {
    await cleanupNodeDnsProbe(input, podName, failure);
  }
}

function readDnsProbeAddresses(output: RegistryDnsProbeOutput, hostname: string, nodeName: string): string[] {
  if (output.status === 'unresolved') {
    throw createDnsResolutionFailure(hostname, nodeName, output.error.code, output.error.message);
  }
  if (!Array.isArray(output.answers)) {
    throw new Error(`Registry DNS probe on node ${nodeName} returned invalid JSON.`);
  }
  return output.answers
    .map((answer: RegistryDnsAnswer): string | undefined => answer.address)
    .filter((address: string | undefined): address is string => address !== undefined);
}

function createDnsResolutionFailure(
  hostname: string,
  nodeName: string,
  code: string,
  message: string,
): RegistryDnsResolutionError {
  return new RegistryDnsResolutionError(
    `Private registry DNS prerequisite failed on node ${nodeName}: ${hostname} could not be resolved (${code}: ${message}). ${registryDnsOperatorGuidance(hostname)}`,
  );
}

function assertDnsAnswers(
  hostname: string,
  serviceAddresses: readonly string[],
  nodeName: string,
  observed: readonly string[],
): void {
  const expected: Set<string> = new Set<string>(serviceAddresses);
  const actual: Set<string> = new Set<string>(observed);
  const matchesExactly: boolean =
    actual.size === expected.size && [...actual].every((address: string): boolean => expected.has(address));
  if (matchesExactly) {
    return;
  }
  const answer: string = observed.length === 0 ? 'no address' : observed.join(', ');
  const records: string = formatRegistryDnsRecords(hostname, serviceAddresses);
  throw new RegistryDnsResolutionError(
    `Private registry DNS prerequisite failed on node ${nodeName}: ${hostname} resolved to ${answer}; required record: ${records}. ${registryDnsOperatorGuidance(hostname)}`,
  );
}

function registryDnsOperatorGuidance(hostname: string): string {
  return `Publish this public DNS name with the cluster-only retained registry-auth Service address. DNS resolvers with rebinding protection must allowlist the domain (for dnsmasq, use rebind-domain-ok=/${readBaseDomain(hostname)}/).`;
}

export function formatRegistryDnsRecords(hostname: string, addresses: readonly string[]): string {
  return addresses
    .map((address: string): string => `${hostname} ${isIP(address) === 6 ? 'AAAA' : 'A'} ${address}`)
    .join(', ');
}

function readBaseDomain(hostname: string): string {
  return hostname.startsWith('registry.') ? hostname.slice('registry.'.length) : hostname;
}

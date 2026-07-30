import { isIP } from 'node:net';
import { runCommand, runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import { readRegistryDnsProbeImage } from './kubernetes-install-registry-dns-image.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';
import { readReadyKubernetesNodeNames } from './kubernetes-ready-nodes.service';
import type {
  RegistryDnsAnswer,
  RegistryDnsProbeAttempt,
  RegistryDnsProbeContainer,
  RegistryService,
} from './kubernetes-install-registry-dns.service.types';

export async function assertKubernetesInstallRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
  probe: RegistryDnsProbeAttempt,
): Promise<void> {
  const serviceAddresses: string[] = await readRegistryServiceAddresses(input);
  const nodeNames: string[] = await readReadyKubernetesNodeNames(input);
  if (nodeNames.length === 0) {
    throw new Error('Registry DNS prerequisite found no eligible Ready nodes.');
  }
  const workerImage: string = await readRegistryDnsProbeImage(input);
  for (let index: number = 0; index < nodeNames.length; index += 1) {
    await assertNodeRegistryDns(
      input,
      state.registryHostname,
      serviceAddresses,
      workerImage,
      nodeNames[index]!,
      index,
      probe,
    );
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
  probe: RegistryDnsProbeAttempt,
): Promise<void> {
  const podName: string = `registry-dns-preflight-${index.toString()}-${probe.nameSuffix}`;
  let failure: Error | null = null;
  try {
    const observed: string[] = await runNodeDnsProbe(input, podName, nodeName, workerImage, hostname, probe.deadline);
    assertDnsAnswers(hostname, serviceAddresses, nodeName, observed);
  } catch (error) {
    failure = error instanceof Error ? error : new Error('Registry DNS probe failed.');
    throw failure;
  } finally {
    await cleanupNodeDnsProbe(input, podName, failure);
  }
}

async function runNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
  workerImage: string,
  hostname: string,
  deadline: number,
): Promise<string[]> {
  await applyNodeDnsProbe(input, podName, nodeName, workerImage, hostname);
  await waitForNodeDnsProbe(input, podName, nodeName, deadline);
  return await readNodeDnsProbeOutput(input, podName, nodeName);
}

async function waitForNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
  deadline: number,
): Promise<void> {
  const commandTimeoutMs: number = readProbeCommandTimeoutMs(deadline);
  const kubectlTimeoutSeconds: number = Math.min(30, Math.max(1, Math.floor((commandTimeoutMs - 1_000) / 1_000)));
  const waitResult: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      'wait',
      `pod/${podName}`,
      '--namespace',
      input.namespace,
      '--for=jsonpath={.status.phase}=Succeeded',
      `--timeout=${kubectlTimeoutSeconds.toString()}s`,
    ]),
    commandTimeoutMs,
  );
  if (waitResult.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry DNS probe failed on node ${nodeName}`, waitResult));
  }
}

function readProbeCommandTimeoutMs(deadline: number): number {
  if (!Number.isFinite(deadline)) {
    return 60_000;
  }
  return Math.max(2_000, Math.min(60_000, deadline - Date.now()));
}

async function applyNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
  workerImage: string,
  hostname: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithInput(
    buildKubectlCommand(input, ['apply', '--filename', '-']),
    buildNodeDnsProbeManifest(input.namespace, podName, nodeName, workerImage, hostname),
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry DNS probe creation failed on node ${nodeName}`, result));
  }
}

function buildNodeDnsProbeManifest(
  namespace: string,
  podName: string,
  nodeName: string,
  workerImage: string,
  hostname: string,
): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace },
    spec: {
      automountServiceAccountToken: false,
      containers: [buildNodeDnsProbeContainer(workerImage, hostname)],
      dnsPolicy: 'Default',
      hostNetwork: true,
      nodeName,
      restartPolicy: 'Never',
    },
  });
}

function buildNodeDnsProbeContainer(workerImage: string, hostname: string): RegistryDnsProbeContainer {
  return {
    args: [
      'require("node:dns").promises.lookup(process.env.REGISTRY_HOST,{all:true,verbatim:true}).then((answers)=>console.log(JSON.stringify(answers)))',
    ],
    command: ['node', '-e'],
    env: [{ name: 'REGISTRY_HOST', value: hostname }],
    image: workerImage,
    name: 'dns',
  };
}

async function readNodeDnsProbeOutput(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
): Promise<string[]> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['logs', `pod/${podName}`, '--namespace', input.namespace]),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry DNS probe output failed on node ${nodeName}`, result));
  }
  try {
    const answers: RegistryDnsAnswer[] = JSON.parse(result.stdout.trim()) as RegistryDnsAnswer[];
    return answers
      .map((answer: RegistryDnsAnswer): string | undefined => answer.address)
      .filter((address: string | undefined): address is string => address !== undefined);
  } catch {
    throw new Error(`Registry DNS probe on node ${nodeName} returned invalid JSON.`);
  }
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
  throw new Error(
    `Private registry DNS prerequisite failed on node ${nodeName}: ${hostname} resolved to ${answer}; required record: ${records}. Publish this public DNS name with the cluster-only retained registry-auth Service address. DNS resolvers with rebinding protection must allowlist the domain (for dnsmasq, use rebind-domain-ok=/${readBaseDomain(hostname)}/).`,
  );
}

export function formatRegistryDnsRecords(hostname: string, addresses: readonly string[]): string {
  return addresses
    .map((address: string): string => `${hostname} ${isIP(address) === 6 ? 'AAAA' : 'A'} ${address}`)
    .join(', ');
}

function readBaseDomain(hostname: string): string {
  return hostname.startsWith('registry.') ? hostname.slice('registry.'.length) : hostname;
}

async function cleanupNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  primaryFailure: Error | null,
): Promise<void> {
  const command: string[] = [
    'delete',
    `pod/${podName}`,
    '--namespace',
    input.namespace,
    '--ignore-not-found',
    '--wait=false',
  ];
  const result: CommandResult = await runCommandWithTimeout(buildKubectlCommand(input, command), 30_000);
  if (result.exitCode === 0) {
    return;
  }
  const cleanupFailure: string = formatKubernetesCommandFailure('Registry DNS probe cleanup failed', result);
  if (primaryFailure !== null) {
    primaryFailure.message = `${primaryFailure.message}\n${cleanupFailure}`;
    return;
  }
  throw new Error(cleanupFailure);
}

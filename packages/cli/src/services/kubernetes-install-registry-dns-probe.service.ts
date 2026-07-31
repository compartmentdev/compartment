import { setTimeout as delay } from 'node:timers/promises';
import { runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';
import type {
  RegistryDnsProbeContainer,
  RegistryDnsAnswerCandidate,
  RegistryDnsProbeOutput,
  RegistryDnsProbeOutputCandidate,
  RegistryDnsProbePod,
} from './kubernetes-install-registry-dns.service.types';

const registryDnsProbeDeadlineMs: number = 60_000;
const registryDnsProbePollDelayMs: number = 250;
const registryDnsProbeScript: string =
  'require("node:dns").promises.lookup(process.env.REGISTRY_HOST,{all:true,verbatim:true}).then((answers)=>console.log(JSON.stringify({status:"resolved",answers}))).catch((error)=>console.log(JSON.stringify({status:"unresolved",error:{code:typeof error.code==="string"?error.code:"UNKNOWN",message:error instanceof Error?error.message:String(error)}})))';

export async function runNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
  workerImage: string,
  hostname: string,
): Promise<RegistryDnsProbeOutput> {
  await applyNodeDnsProbe(input, podName, nodeName, workerImage, hostname);
  await waitForNodeDnsProbe(input, podName, nodeName);
  return await readNodeDnsProbeOutput(input, podName, nodeName);
}

async function waitForNodeDnsProbe(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
): Promise<void> {
  const deadline: number = Date.now() + registryDnsProbeDeadlineMs;
  let lastPhase: string = 'unknown';
  while (Date.now() < deadline) {
    lastPhase = await readNodeDnsProbePhase(input, podName, nodeName);
    if (lastPhase === 'Succeeded') {
      return;
    }
    if (lastPhase === 'Failed') {
      const logs: string = await readNodeDnsProbeLogs(input, podName, nodeName);
      throw new Error(
        `Registry DNS probe pod ${podName} on node ${nodeName} reached terminal phase Failed. Logs: ${logs}`,
      );
    }
    await delay(registryDnsProbePollDelayMs);
  }
  throw new Error(
    `Registry DNS probe on node ${nodeName} did not reach a terminal phase before its deadline (last phase: ${lastPhase}).`,
  );
}

async function readNodeDnsProbePhase(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
): Promise<string> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['get', `pod/${podName}`, '--namespace', input.namespace, '-o=json']),
    10_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry DNS probe status failed on node ${nodeName}`, result));
  }
  try {
    const pod: RegistryDnsProbePod = JSON.parse(result.stdout) as RegistryDnsProbePod;
    return pod.status?.phase ?? 'unknown';
  } catch {
    throw new Error(`Registry DNS probe status on node ${nodeName} returned invalid JSON.`);
  }
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
    args: [registryDnsProbeScript],
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
): Promise<RegistryDnsProbeOutput> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['logs', `pod/${podName}`, '--namespace', input.namespace]),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry DNS probe output failed on node ${nodeName}`, result));
  }
  try {
    return requireRegistryDnsProbeOutput(JSON.parse(result.stdout.trim()) as RegistryDnsProbeOutputCandidate, nodeName);
  } catch {
    throw new Error(`Registry DNS probe on node ${nodeName} returned invalid JSON.`);
  }
}

async function readNodeDnsProbeLogs(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
): Promise<string> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['logs', `pod/${podName}`, '--namespace', input.namespace]),
    30_000,
  );
  if (result.exitCode !== 0) {
    return formatKubernetesCommandFailure(`output unavailable on node ${nodeName}`, result);
  }
  const logs: string = result.stdout.trim();
  return logs === '' ? '<empty>' : logs.slice(0, 1_000);
}

function requireRegistryDnsProbeOutput(
  output: RegistryDnsProbeOutputCandidate,
  nodeName: string,
): RegistryDnsProbeOutput {
  if (
    output.status === 'resolved' &&
    Array.isArray(output.answers) &&
    output.answers.every((answer: RegistryDnsAnswerCandidate): boolean => typeof answer.address === 'string')
  ) {
    return output as RegistryDnsProbeOutput;
  }
  if (
    output.status === 'unresolved' &&
    output.error !== undefined &&
    typeof output.error.code === 'string' &&
    typeof output.error.message === 'string'
  ) {
    return output as RegistryDnsProbeOutput;
  }
  throw new Error(`Registry DNS probe on node ${nodeName} returned invalid JSON.`);
}

export async function cleanupNodeDnsProbe(
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
    '--wait=true',
    '--timeout=30s',
  ];
  const result: CommandResult = await runCommandWithTimeout(buildKubectlCommand(input, command), 30_000);
  if (result.exitCode === 0) {
    return;
  }
  const cleanupFailure: string = formatKubernetesCommandFailure('Registry DNS probe cleanup failed', result);
  if (primaryFailure !== null) {
    throw new Error(`${primaryFailure.message}\n${cleanupFailure}`);
  }
  throw new Error(cleanupFailure);
}

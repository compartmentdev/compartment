import type { KubernetesPlatformWorkloadStatus } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  buildHelmKubeContextArgs,
  buildKubectlCommand,
  buildKubernetesReleaseSelector,
  readCommandOutput,
} from './kubernetes-command.support';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import type {
  KubernetesHelmStatusJsonObject,
  KubernetesWorkloadList,
  KubernetesWorkloadListItem,
} from './kubernetes-system-status.service.types';

export async function readKubernetesHelmReleaseStatus(target: KubernetesOperatorTarget): Promise<string> {
  const result: CommandResult = await runCommand([
    'helm',
    'status',
    target.releaseName,
    '--namespace',
    target.namespace,
    '--output',
    'json',
    ...buildHelmKubeContextArgs(target),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read Helm release status: ${readCommandOutput(result)}`);
  }
  const root: KubernetesHelmStatusJsonObject = readJsonObject(result.stdout, 'Helm returned invalid status JSON.');
  const info: KubernetesHelmStatusJsonObject = readJsonObject(root.info, 'Helm returned status without release info.');
  if (typeof info.status !== 'string' || info.status === '') {
    throw new Error('Helm returned status without a release state.');
  }
  return info.status;
}

export async function readKubernetesPlatformWorkloads(
  target: KubernetesOperatorTarget,
): Promise<KubernetesPlatformWorkloadStatus[]> {
  const result: CommandResult = await runCommand(
    buildKubectlCommand(target, [
      'get',
      'deployment,daemonset',
      '--selector',
      buildKubernetesReleaseSelector(target.releaseName),
      '--output',
      'json',
    ]),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read Kubernetes platform workload readiness: ${readCommandOutput(result)}`);
  }
  const list: KubernetesWorkloadList = parseWorkloadList(result.stdout);
  if (!Array.isArray(list.items)) {
    throw new Error('Kubectl returned workload JSON without an items array.');
  }
  return list.items.map(readWorkloadStatus).sort(compareWorkloads);
}

function parseWorkloadList(output: string): KubernetesWorkloadList {
  try {
    return JSON.parse(output) as KubernetesWorkloadList;
  } catch {
    throw new Error('Kubectl returned invalid workload JSON.');
  }
}

function readWorkloadStatus(item: KubernetesWorkloadListItem): KubernetesPlatformWorkloadStatus {
  const name: string = readRequiredString(item.metadata?.name, 'workload name');
  if (item.kind === 'Deployment') {
    const desiredReplicas: number = readReplicaCount(item.spec?.replicas, 1, `${name} desired replicas`);
    const readyReplicas: number = readReplicaCount(item.status?.readyReplicas, 0, `${name} ready replicas`);
    return { desiredReplicas, kind: 'Deployment', name, ready: readyReplicas >= desiredReplicas, readyReplicas };
  }
  if (item.kind === 'DaemonSet') {
    const desiredReplicas: number = readReplicaCount(
      item.status?.desiredNumberScheduled,
      0,
      `${name} desired replicas`,
    );
    const readyReplicas: number = readReplicaCount(item.status?.numberReady, 0, `${name} ready replicas`);
    return { desiredReplicas, kind: 'DaemonSet', name, ready: readyReplicas >= desiredReplicas, readyReplicas };
  }
  throw new Error(`Kubectl returned unsupported workload kind for ${name}.`);
}

function readReplicaCount(value: JsonValue | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return value;
}

function readRequiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Expected a non-empty ${label}.`);
  }
  return value;
}

function readJsonObject(value: JsonValue | string | undefined, message: string): KubernetesHelmStatusJsonObject {
  let parsed: JsonValue = value ?? null;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as JsonValue;
    } catch {
      throw new Error(message);
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(message);
  }
  return parsed;
}

function compareWorkloads(left: KubernetesPlatformWorkloadStatus, right: KubernetesPlatformWorkloadStatus): number {
  return `${left.kind}/${left.name}`.localeCompare(`${right.kind}/${right.name}`);
}

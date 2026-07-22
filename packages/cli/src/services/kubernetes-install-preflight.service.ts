import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { JsonValue } from '@compartment/utils';
import { parse } from 'yaml';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  buildIngressConflictMessage,
  buildMissingKubeconfigMessage,
  formatCheckedCandidate,
} from './kubernetes-install-preflight.messages';
import type {
  KubernetesIngressPortConflict,
  KubernetesInstallPreflightInput,
  KubernetesInstallPreflightResult,
  KubernetesKubeconfigCandidate,
  KubernetesKubeconfigCandidateResult,
  KubernetesKubeconfigResolutionInput,
  KubernetesPreflightServiceItem,
  KubernetesPreflightServiceList,
  KubernetesServicePort,
  KubernetesStorageClassItem,
  KubernetesStorageClassList,
  ResolvedKubernetesKubeconfig,
} from './kubernetes-install-preflight.service.types';

const defaultK3sKubeconfigPath: string = '/etc/rancher/k3s/k3s.yaml';
const requestTimeout: string = '3s';

export class KubernetesInstallPreflightError extends Error {
  readonly check: 'cluster' | 'ingress ports' | 'storage class';

  constructor(check: 'cluster' | 'ingress ports' | 'storage class', message: string) {
    super(message);
    this.check = check;
  }
}

export async function resolveKubernetesInstallKubeconfig(
  input: KubernetesKubeconfigResolutionInput = { env: process.env, homeDirectory: homedir() },
): Promise<ResolvedKubernetesKubeconfig> {
  const homePath: string = join(input.homeDirectory, '.kube', 'config');
  const k3sPath: string = input.k3sPath ?? defaultK3sKubeconfigPath;
  const checked: string[] = [];
  for (const candidate of buildKubeconfigCandidates(input.env.KUBECONFIG, homePath, k3sPath)) {
    const result: KubernetesKubeconfigCandidateResult = await readKubeconfigCandidate(
      candidate.path,
      candidate.label,
      input.contextName,
    );
    if (result.resolved !== null) {
      return result.resolved;
    }
    checked.push(formatCheckedCandidate(candidate.path, candidate.displayPath, candidate.configured, result.reason));
  }
  throw new Error(buildMissingKubeconfigMessage(checked));
}

export async function runKubernetesInstallPreflight(
  input: KubernetesInstallPreflightInput,
): Promise<KubernetesInstallPreflightResult> {
  await assertClusterReachable(input);
  const services: KubernetesPreflightServiceList = await readClusterJson<KubernetesPreflightServiceList>(
    buildKubectlCommand(input, ['get', 'services', '--all-namespaces', '--output', 'json']),
    'ingress ports',
    'services',
  );
  const conflict: KubernetesIngressPortConflict | null = findIngressPortConflict(
    services.items,
    input.releaseName,
    input.namespace,
  );
  if (conflict !== null) {
    throw new KubernetesInstallPreflightError('ingress ports', buildIngressConflictMessage(conflict));
  }
  if (!input.detectStorageClass) {
    return { storageClass: '' };
  }
  return { storageClass: await readDetectedStorageClass(input) };
}

async function readDetectedStorageClass(input: KubernetesInstallPreflightInput): Promise<string> {
  const storageClasses: KubernetesStorageClassList = await readClusterJson<KubernetesStorageClassList>(
    buildKubectlCommand(input, ['get', 'storageclass', '--output', 'json']),
    'storage class',
    'storage classes',
  );
  return detectStorageClass(storageClasses);
}

function findIngressPortConflict(
  services: readonly KubernetesPreflightServiceItem[],
  releaseName: string,
  namespace: string,
): KubernetesIngressPortConflict | null {
  const service: KubernetesPreflightServiceItem | undefined = services.find(
    (candidate: KubernetesPreflightServiceItem): boolean =>
      candidate.spec?.type === 'LoadBalancer' &&
      !isReleaseCaddyService(candidate, releaseName, namespace) &&
      (candidate.spec.ports ?? []).some(
        (port: KubernetesServicePort): boolean => port.port === 80 || port.port === 443,
      ),
  );
  const name: string | undefined = service?.metadata?.name;
  if (service === undefined || name === undefined) {
    return null;
  }
  return { name, namespace: service.metadata?.namespace ?? 'default' };
}

function buildKubeconfigCandidates(
  environmentValue: string | undefined,
  homePath: string,
  k3sPath: string,
): KubernetesKubeconfigCandidate[] {
  const environmentPaths: string[] =
    environmentValue?.split(delimiter).filter((path: string): boolean => path !== '') ?? [];
  return [
    ...environmentPaths.map(
      (path: string): KubernetesKubeconfigCandidate => ({ configured: true, displayPath: path, path }),
    ),
    { configured: false, displayPath: '~/.kube/config', path: homePath },
    { configured: false, displayPath: k3sPath, label: 'k3s', path: k3sPath },
  ];
}

async function readKubeconfigCandidate(
  path: string,
  label?: string,
  contextName?: string,
): Promise<KubernetesKubeconfigCandidateResult> {
  try {
    await access(path);
  } catch {
    return { reason: 'not found', resolved: null };
  }
  try {
    const value: JsonValue = parse(await readFile(path, 'utf8')) as JsonValue;
    const resolved: ResolvedKubernetesKubeconfig | null = parseKubeconfig(value, path, label, contextName);
    return resolved === null ? { reason: 'no current context', resolved: null } : { reason: 'unusable', resolved };
  } catch {
    return { reason: 'unusable', resolved: null };
  }
}

function parseKubeconfig(
  value: JsonValue,
  path: string,
  label?: string,
  requestedContextName?: string,
): ResolvedKubernetesKubeconfig | null {
  if (!isObject(value) || typeof value['current-context'] !== 'string' || value['current-context'].trim() === '') {
    return null;
  }
  const clusters: JsonValue | undefined = value.clusters;
  const contexts: JsonValue | undefined = value.contexts;
  if (!Array.isArray(clusters) || clusters.length === 0 || !Array.isArray(contexts)) {
    return null;
  }
  const contextName: string = requestedContextName ?? value['current-context'];
  const clusterName: string | undefined = readCurrentClusterName(contexts, contextName);
  const clusterServer: string | undefined = readClusterServer(clusters, clusterName);
  if (clusterServer === undefined) {
    return null;
  }
  return { clusterServer, contextName, ...(label === undefined ? {} : { label }), path };
}

function readCurrentClusterName(contexts: JsonValue[], contextName: string): string | undefined {
  const context: JsonValue | undefined = contexts.find(
    (candidate: JsonValue): boolean => isObject(candidate) && candidate.name === contextName,
  );
  return isObject(context) && isObject(context.context) && typeof context.context.cluster === 'string'
    ? context.context.cluster
    : undefined;
}

function readClusterServer(clusters: JsonValue[], clusterName: string | undefined): string | undefined {
  const cluster: JsonValue | undefined = clusters.find(
    (candidate: JsonValue): boolean => isObject(candidate) && candidate.name === clusterName,
  );
  return isObject(cluster) &&
    isObject(cluster.cluster) &&
    typeof cluster.cluster.server === 'string' &&
    cluster.cluster.server.trim() !== ''
    ? cluster.cluster.server.trim()
    : undefined;
}

async function assertClusterReachable(input: KubernetesInstallPreflightInput): Promise<void> {
  const result: CommandResult = await runCommand(buildKubectlCommand(input, ['version', '--output', 'json']));
  if (result.exitCode !== 0) {
    throw new KubernetesInstallPreflightError(
      'cluster',
      `Cannot reach Kubernetes cluster at ${input.resolvedKubeconfig.clusterServer}. Verify the cluster is running and your kubeconfig credentials are valid, then retry install.`,
    );
  }
}

async function readClusterJson<T>(
  command: string[],
  check: 'ingress ports' | 'storage class',
  subject: string,
): Promise<T> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode !== 0) {
    throw new KubernetesInstallPreflightError(
      check,
      `Cannot inspect Kubernetes ${subject}. Verify your cluster access and retry install.`,
    );
  }
  try {
    const value: JsonValue = JSON.parse(result.stdout) as JsonValue;
    if (isObject(value) && Array.isArray(value.items)) {
      return value as T;
    }
  } catch {
    // The shared error below is stable for malformed kubectl output.
  }
  throw new KubernetesInstallPreflightError(check, `Kubernetes returned an invalid ${subject} response.`);
}

function buildKubectlCommand(input: KubernetesInstallPreflightInput, args: readonly string[]): string[] {
  return [
    'kubectl',
    '--kubeconfig',
    input.resolvedKubeconfig.path,
    ...(input.kubeContext === undefined ? [] : ['--context', input.kubeContext]),
    '--request-timeout',
    requestTimeout,
    ...args,
  ];
}

function isReleaseCaddyService(
  service: KubernetesPreflightServiceItem,
  releaseName: string,
  namespace: string,
): boolean {
  return (
    service.metadata?.namespace === namespace &&
    service.metadata.labels?.['app.kubernetes.io/instance'] === releaseName &&
    service.metadata.labels['app.kubernetes.io/component'] === 'caddy'
  );
}

function detectStorageClass(list: KubernetesStorageClassList): string {
  return list.items.some((item: KubernetesStorageClassItem): boolean => item.metadata?.name === 'local-path')
    ? 'local-path'
    : '';
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  KubernetesIngressPortConflict,
  KubernetesInstallPreflightInput,
  KubernetesInstallPreflightResult,
  KubernetesPreflightServiceItem,
  KubernetesPreflightServiceList,
  KubernetesServicePort,
  KubernetesStorageClassItem,
  KubernetesStorageClassList,
} from './kubernetes-install-preflight.service.types';

const requestTimeout: string = '3s';

export class KubernetesInstallPreflightError extends Error {
  readonly check: 'cluster' | 'ingress ports' | 'storage class';

  constructor(check: 'cluster' | 'ingress ports' | 'storage class', message: string) {
    super(message);
    this.check = check;
  }
}

export async function runKubernetesInstallPreflight(
  input: KubernetesInstallPreflightInput,
): Promise<KubernetesInstallPreflightResult> {
  await assertClusterReachable(input);
  const conflict: KubernetesIngressPortConflict | null = await readIngressPortConflict(input);
  if (conflict !== null) {
    return await handleIngressPortConflict(input, conflict);
  }
  return { storageClass: input.detectStorageClass ? await readDetectedStorageClass(input) : '' };
}

async function readIngressPortConflict(
  input: KubernetesInstallPreflightInput,
): Promise<KubernetesIngressPortConflict | null> {
  const services: KubernetesPreflightServiceList = await readClusterJson<KubernetesPreflightServiceList>(
    buildKubectlCommand(input, ['get', 'services', '--all-namespaces', '--output', 'json']),
    'ingress ports',
    'services',
  );
  return findIngressPortConflict(services.items, input.releaseName, input.namespace);
}

async function handleIngressPortConflict(
  input: KubernetesInstallPreflightInput,
  conflict: KubernetesIngressPortConflict,
): Promise<KubernetesInstallPreflightResult> {
  if (await isKlipperEnvironment(input)) {
    throw new KubernetesInstallPreflightError('ingress ports', buildIngressConflictMessage(conflict));
  }
  const storageClass: string = input.detectStorageClass ? await readDetectedStorageClass(input) : '';
  return { ingressWarning: conflict, storageClass };
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

async function assertClusterReachable(input: KubernetesInstallPreflightInput): Promise<void> {
  const result: CommandResult = await runCommand(buildKubectlCommand(input, ['version', '--output', 'json']));
  if (result.exitCode !== 0) {
    if (result.exitCode === 127) {
      throw new KubernetesInstallPreflightError('cluster', 'kubectl is not installed or not on PATH.');
    }
    throw new KubernetesInstallPreflightError(
      'cluster',
      `Cannot reach Kubernetes cluster at ${input.resolvedKubeconfig.clusterServer}. Verify the cluster is running and your kubeconfig credentials are valid, then retry install.`,
    );
  }
}

async function isKlipperEnvironment(input: KubernetesInstallPreflightInput): Promise<boolean> {
  const result: CommandResult = await runCommand(
    buildKubectlCommand(input, ['get', 'daemonsets', '--all-namespaces', '--output', 'json']),
  );
  if (result.exitCode !== 0) {
    return false;
  }
  try {
    const value: JsonValue = JSON.parse(result.stdout) as JsonValue;
    if (!isObject(value) || !Array.isArray(value.items)) {
      return false;
    }
    return value.items.some(
      (daemonSet: JsonValue): boolean =>
        isObject(daemonSet) &&
        isObject(daemonSet.metadata) &&
        typeof daemonSet.metadata.name === 'string' &&
        daemonSet.metadata.name.startsWith('svclb-'),
    );
  } catch {
    return false;
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

function buildIngressConflictMessage(conflict: KubernetesIngressPortConflict): string {
  return `Ports 80/443 are already taken by Service ${conflict.namespace}/${conflict.name} — the platform's Caddy LoadBalancer will never get an address. On k3s disable Traefik: printf 'disable:\\n  - traefik\\n' >/etc/rancher/k3s/config.yaml && systemctl restart k3s && kubectl -n kube-system delete helmchart traefik traefik-crd. Then retry install.`;
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type { KubernetesInstallInput } from './kubernetes-install-input.service.types';
import type {
  KubernetesApiResource,
  KubernetesApiResourceList,
  KubernetesExistingClusterPreflightCheck,
  KubernetesObject,
  KubernetesObjectMetadata,
  KubernetesOwnedResource,
  KubernetesOwnedResourceTarget,
  KubernetesVersionResponse,
} from './kubernetes-existing-cluster-preflight.service.types';
import {
  buildPreflightKubectl,
  certManagerInstallInstruction,
  helmReleaseNameAnnotation,
  helmReleaseNamespaceAnnotation,
  isPreflightNotFound,
  KubernetesExistingClusterPreflightError,
  parsePreflightJson,
  readPreflightObject,
} from './kubernetes-existing-cluster-preflight.support';
import {
  readClusterOwnedTargets,
  requiredApiResources,
  requiredPermissions,
  type KubernetesApiRequirement,
  type KubernetesPermissionRequirement,
} from './kubernetes-existing-cluster-preflight.requirements';

const minimumKubernetesMinor: number = 30;
export async function assertClusterVersion(input: KubernetesInstallInput): Promise<string> {
  const result: CommandResult = await runCommand(buildPreflightKubectl(input, ['version', '--output=json']));
  if (result.exitCode === 127) {
    throw new KubernetesExistingClusterPreflightError('cluster', 'kubectl is not installed or not on PATH.');
  }
  const response: KubernetesVersionResponse = readPreflightObject(
    result,
    'cluster',
    `Cannot reach Kubernetes cluster for context "${input.kubeContext}".`,
  );
  const version: string | undefined = response.serverVersion?.gitVersion;
  const match: RegExpExecArray | null = version === undefined ? null : /^v1\.(\d+)(?:\.|$)/u.exec(version);
  if (match === null || Number(match[1]) < minimumKubernetesMinor) {
    throw unsupportedVersion(version);
  }
  return version!;
}

export async function assertRequiredApiResources(input: KubernetesInstallInput): Promise<void> {
  await assertApiResources(input, requiredApiResources, 'api resources');
}

export async function assertApiResources(
  input: KubernetesInstallInput,
  requirements: readonly KubernetesApiRequirement[],
  check: 'api resources' | 'cert-manager',
): Promise<void> {
  const missing: string[] = [];
  for (const [path, resources] of requirements) {
    missing.push(...(await readMissingApiResources(input, path, resources, check)));
  }
  if (missing.length > 0) {
    throw missingApiError(check, missing);
  }
}

export async function assertPermissions(input: KubernetesInstallInput): Promise<void> {
  const results: string[] = [];
  for (const permission of requiredPermissions) {
    const failure: string | undefined = await readPermissionFailure(input, permission);
    if (failure !== undefined) {
      results.push(failure);
    }
  }
  if (results.length > 0) {
    throw new KubernetesExistingClusterPreflightError(
      'permissions',
      `Missing Kubernetes permissions: ${results.join(', ')}.`,
    );
  }
}

export async function assertReleaseOwnership(input: KubernetesInstallInput, chartFullname: string): Promise<void> {
  await assertNamespaceOwnership(input);
  for (const target of readClusterOwnedTargets(chartFullname)) {
    await assertClusterResourceOwnership(input, target);
  }
}

async function assertClusterResourceOwnership(
  input: KubernetesInstallInput,
  target: KubernetesOwnedResourceTarget,
): Promise<void> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', target.resource, target.name, '-o=json']),
  );
  if (isPreflightNotFound(result)) {
    return;
  }
  const item: KubernetesOwnedResource = readPreflightObject(
    result,
    'release ownership',
    `Cannot inspect ${target.kind} ${target.name}.`,
  );
  assertOwnedResource({ ...item, kind: target.kind }, input);
}

async function readMissingApiResources(
  input: KubernetesInstallInput,
  path: string,
  resources: readonly string[],
  check: 'api resources' | 'cert-manager',
): Promise<string[]> {
  const result: CommandResult = await runCommand(buildPreflightKubectl(input, ['get', '--raw', path]));
  if (result.exitCode !== 0) {
    return [`${path} (API not served)`];
  }
  const list: KubernetesApiResourceList = parsePreflightJson(
    result.stdout,
    check,
    `Kubernetes returned invalid discovery for ${path}.`,
  );
  const served: Set<string> = new Set<string>(
    (list.resources ?? [])
      .map((resource: KubernetesApiResource): string | undefined => resource.name)
      .filter((name: string | undefined): name is string => name !== undefined),
  );
  return resources
    .filter((resource: string): boolean => !served.has(resource))
    .map((resource: string): string => `${resource} at ${path}`);
}

async function readPermissionFailure(
  input: KubernetesInstallInput,
  permission: KubernetesPermissionRequirement,
): Promise<string | undefined> {
  const [verb, resource, scope] = permission;
  const args: string[] = ['auth', 'can-i', verb, resource];
  if (scope !== 'cluster') {
    args.push('--namespace', scope === 'default' ? 'default' : input.namespace);
  }
  const result: CommandResult = await runCommand(buildPreflightKubectl(input, args));
  const scopeMessage: string =
    scope === 'cluster' ? ' cluster-wide' : ` in namespace ${scope === 'default' ? 'default' : input.namespace}`;
  return result.exitCode === 0 && result.stdout.trim() === 'yes' ? undefined : `${verb} ${resource}${scopeMessage}`;
}

async function assertNamespaceOwnership(input: KubernetesInstallInput): Promise<void> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'namespace', input.namespace, '-o=json']),
  );
  if (isPreflightNotFound(result)) {
    return;
  }
  const value: KubernetesObject = readPreflightObject(
    result,
    'release ownership',
    `Cannot inspect namespace ${input.namespace}.`,
  );
  assertHelmOwnership(value.metadata, input, `Namespace ${input.namespace}`);
}

function assertOwnedResource(item: KubernetesOwnedResource, input: KubernetesInstallInput): void {
  assertExactHelmOwnership(item.metadata, input, `${item.kind} ${item.metadata?.name ?? '<unnamed>'}`);
}

function assertHelmOwnership(
  metadata: KubernetesObjectMetadata | undefined,
  input: KubernetesInstallInput,
  subject: string,
): void {
  const releaseName: string | undefined = metadata?.annotations?.[helmReleaseNameAnnotation];
  const releaseNamespace: string | undefined = metadata?.annotations?.[helmReleaseNamespaceAnnotation];
  const wrongName: boolean = releaseName !== undefined && releaseName !== input.releaseName;
  const wrongNamespace: boolean = releaseNamespace !== undefined && releaseNamespace !== input.namespace;
  if (wrongName || wrongNamespace) {
    throw new KubernetesExistingClusterPreflightError(
      'release ownership',
      `${subject} is owned by Helm release ${releaseNamespace ?? '<unknown>'}/${releaseName ?? '<unknown>'}, not ${input.namespace}/${input.releaseName}.`,
    );
  }
}

export function assertExactHelmOwnership(
  metadata: KubernetesObjectMetadata | undefined,
  input: KubernetesInstallInput,
  subject: string,
): void {
  const releaseName: string | undefined = metadata?.annotations?.[helmReleaseNameAnnotation];
  const releaseNamespace: string | undefined = metadata?.annotations?.[helmReleaseNamespaceAnnotation];
  if (releaseName !== input.releaseName || releaseNamespace !== input.namespace) {
    throw new KubernetesExistingClusterPreflightError(
      'release ownership',
      `${subject} is owned by Helm release ${releaseNamespace ?? '<unknown>'}/${releaseName ?? '<unknown>'}, not ${input.namespace}/${input.releaseName}.`,
    );
  }
}

function unsupportedVersion(version: string | undefined): KubernetesExistingClusterPreflightError {
  return new KubernetesExistingClusterPreflightError(
    'cluster',
    `Kubernetes 1.${String(minimumKubernetesMinor)} or newer is required; detected ${version ?? 'an unknown version'}.`,
  );
}

function missingApiError(
  check: KubernetesExistingClusterPreflightCheck,
  missing: readonly string[],
): KubernetesExistingClusterPreflightError {
  const suffix: string = check === 'cert-manager' ? ` ${certManagerInstallInstruction}` : '';
  return new KubernetesExistingClusterPreflightError(
    check,
    `Missing required ${check}: ${missing.join(', ')}.${suffix}`,
  );
}

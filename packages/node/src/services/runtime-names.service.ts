import { createHash } from 'node:crypto';

const maxUpstreamHostLength: number = 63;
const maxDockerContainerNameLength: number = 255;
const identityHashLength: number = 12;
const shortenedNetworkAliasPrefixLength: number = maxUpstreamHostLength - identityHashLength - 1;
const shortenedContainerNamePrefixLength: number = maxDockerContainerNameLength - identityHashLength - 1;
const aliasHashPattern: RegExp = /^[a-f0-9]{12}$/;

interface RuntimeContainerIdentity {
  environmentName: string;
  projectName: string;
  serviceName: string;
}

interface RuntimeResourceIdentity {
  environmentName: string;
  projectName: string;
  resourceName: string;
}

interface DeploymentContainerIdentity extends RuntimeContainerIdentity {
  deploymentId: string;
}

interface RuntimeNetworkIdentity {
  environmentId: string;
  projectId: string;
  serviceId: string;
}

interface RuntimeResourceNetworkIdentity {
  environmentId: string;
  projectId: string;
}

export function buildDeploymentContainerName(input: DeploymentContainerIdentity, dockerNamespace: string): string {
  return buildRuntimeIdentitySegments(input, dockerNamespace).map(sanitizeContainerName).join('-');
}

export function buildDeploymentReleaseContainerName(
  input: DeploymentContainerIdentity,
  dockerNamespace: string,
): string {
  return buildTransientContainerName([...buildRuntimeIdentitySegments(input, dockerNamespace), 'release']);
}

export function buildDeploymentUpstreamHost(input: DeploymentContainerIdentity, dockerNamespace: string): string {
  const alias: string = buildRuntimeIdentitySegments(input, dockerNamespace)
    .map(sanitizeRuntimeNetworkSegment)
    .join('-');

  return shortenNetworkAlias(alias);
}

export function buildResourceContainerName(input: RuntimeResourceIdentity, dockerNamespace: string): string {
  return buildResourceIdentitySegments(input, dockerNamespace).map(sanitizeContainerName).join('-');
}

export function buildResourceOperationContainerName(input: RuntimeResourceIdentity, dockerNamespace: string): string {
  return buildTransientContainerName([
    ...buildResourceIdentitySegments(input, dockerNamespace),
    'operation',
    createIdentityHash(String(Date.now())),
  ]);
}

export function buildResourceNetworkAlias(input: RuntimeResourceIdentity, dockerNamespace: string): string {
  const alias: string = buildResourceIdentitySegments(input, dockerNamespace)
    .map(sanitizeRuntimeNetworkSegment)
    .join('-');

  return shortenNetworkAlias(alias);
}

export function buildResourceVolumeName(
  input: RuntimeResourceIdentity,
  dockerNamespace: string,
  volumeName: string,
): string {
  return [...buildResourceIdentitySegments(input, dockerNamespace), volumeName].map(sanitizeContainerName).join('-');
}

export function buildRuntimeResourceNetworkName(
  input: RuntimeResourceNetworkIdentity,
  dockerNamespace: string,
): string {
  return shortenRuntimeNetworkName(
    ['compartment', dockerNamespace, input.projectId, input.environmentId, 'resources'].map(
      sanitizeRuntimeNetworkSegment,
    ),
  );
}

export function buildRuntimeServiceNetworkName(input: RuntimeNetworkIdentity, dockerNamespace: string): string {
  return shortenRuntimeNetworkName(
    ['compartment', dockerNamespace, input.projectId, input.environmentId, input.serviceId].map(
      sanitizeRuntimeNetworkSegment,
    ),
  );
}

export function buildSystemNetworkName(dockerNamespace: string): string {
  return `${dockerNamespace}_system_internal`;
}

export function buildDbNetworkName(dockerNamespace: string): string {
  return `${dockerNamespace}_db_internal`;
}

export function isRuntimeNetworkName(networkName: string, dockerNamespace: string): boolean {
  const runtimeNetworkPrefix: string = buildRuntimeNetworkPrefix(dockerNamespace);
  if (networkName.startsWith(runtimeNetworkPrefix)) {
    return true;
  }

  return isShortenedRuntimeNetworkName(networkName, runtimeNetworkPrefix);
}

function buildRuntimeNetworkPrefix(dockerNamespace: string): string {
  return `compartment-${sanitizeRuntimeNetworkSegment(dockerNamespace)}-`;
}

function isShortenedRuntimeNetworkName(networkName: string, runtimeNetworkPrefix: string): boolean {
  if (runtimeNetworkPrefix.length <= shortenedNetworkAliasPrefixLength) {
    return false;
  }

  const shortenedPrefix: string = trimAliasEdges(runtimeNetworkPrefix.slice(0, shortenedNetworkAliasPrefixLength));
  if (shortenedPrefix === '' || !networkName.startsWith(`${shortenedPrefix}-`)) {
    return false;
  }

  return aliasHashPattern.test(networkName.slice(shortenedPrefix.length + 1));
}

function buildRuntimeIdentitySegments(input: DeploymentContainerIdentity, dockerNamespace: string): string[] {
  return [
    'compartment',
    dockerNamespace,
    input.projectName,
    input.environmentName,
    input.serviceName,
    input.deploymentId,
  ];
}

function buildResourceIdentitySegments(input: RuntimeResourceIdentity, dockerNamespace: string): string[] {
  return ['compartment', dockerNamespace, input.projectName, input.environmentName, 'resource', input.resourceName];
}

function sanitizeContainerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

function sanitizeRuntimeNetworkSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function shortenRuntimeNetworkName(segments: string[]): string {
  return shortenNetworkAlias(segments.join('-'));
}

function shortenNetworkAlias(value: string): string {
  const alias: string = trimAliasEdges(value);
  if (alias.length <= maxUpstreamHostLength) {
    return alias;
  }

  const hash: string = createIdentityHash(alias);
  const prefix: string = trimAliasEdges(alias.slice(0, shortenedNetworkAliasPrefixLength));

  return prefix === '' ? hash : `${prefix}-${hash}`;
}

function buildTransientContainerName(segments: string[]): string {
  return shortenContainerName(segments.map(sanitizeContainerName).join('-'));
}

function shortenContainerName(value: string): string {
  if (value.length <= maxDockerContainerNameLength) {
    return value;
  }

  const hash: string = createIdentityHash(value);
  const prefix: string = trimContainerNameEdges(value.slice(0, shortenedContainerNamePrefixLength));

  return prefix === '' ? hash : `${prefix}-${hash}`;
}

function trimAliasEdges(value: string): string {
  return value.replace(/^-+|-+$/g, '');
}

function trimContainerNameEdges(value: string): string {
  return value.replace(/^[_.-]+|[_.-]+$/g, '');
}

function createIdentityHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, identityHashLength);
}

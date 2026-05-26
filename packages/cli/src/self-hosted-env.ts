import { randomBytes } from 'node:crypto';
import {
  readSelfHostedEnvironmentAssignmentName,
  readSelfHostedEnvironmentAssignmentValue,
  renderSelfHostedEnvironmentAssignment,
} from './self-hosted-env-assignment';
import { buildCustomTlsOverrides } from './self-hosted-env-custom-domain';
import {
  selfHostedInternalCaddyTlsMode,
  selfHostedManagedAcmeCaUrl,
  selfHostedManagedCaddyTlsMode,
} from './self-hosted-domain-constants';
import { readUpdatedCanonicalOverrides } from './self-hosted-env-update-overrides';
import type {
  BuildSelfHostedEnvironmentInput,
  BuildUpdatedSelfHostedEnvironmentInput,
  SelfHostedImageRefs,
  RenderedSelfHostedEnvironment,
} from './self-hosted-env.types';
import type { ManagedDomainInstallState } from './managed-domain.types';

const defaultSelfHostedDockerNamespace: string = 'compartment';
const defaultRuntimeUpstreamHost: string = 'host.docker.internal';
export const defaultNodeAgentSocketPath: string = '/var/run/compartment/node/agent.sock';
export const defaultSystemApiSocketPath: string = '/var/run/compartment/api/system-api.sock';
export {
  buildPublishedSelfHostedRuntimeSelection,
  defaultSelfHostedRuntimeImageRegistry,
  readSelfHostedImageRefsFromEnvironmentText,
} from './self-hosted-runtime-selection';

interface ManagedDomainTlsEnvironment {
  brokerUrl: string;
  brokerToken: string;
}

export function buildSelfHostedEnvironment(input: BuildSelfHostedEnvironmentInput): RenderedSelfHostedEnvironment {
  const overrides: Record<string, string> = buildSelfHostedOverrides(input);
  return renderSelfHostedEnvironment(input.templateText, overrides, overrides);
}

export function buildUpdatedSelfHostedEnvironment(
  input: BuildUpdatedSelfHostedEnvironmentInput,
): RenderedSelfHostedEnvironment {
  const canonicalOverrides: Record<string, string> = buildSelfHostedOverrides(input);
  const overrides: Record<string, string> = buildUpdatedSelfHostedOverrides(
    input.templateText,
    input.currentValues,
    canonicalOverrides,
  );

  return renderSelfHostedEnvironment(input.templateText, overrides, canonicalOverrides);
}

export function createRandomSecret(lengthBytes: number = 24): string {
  return randomBytes(lengthBytes).toString('hex');
}

function buildSelfHostedOverrides(input: BuildSelfHostedEnvironmentInput): Record<string, string> {
  const managedDomainTls: ManagedDomainTlsEnvironment | null = readManagedDomainTlsEnvironment(input);

  return {
    ...buildManagedDomainTlsOverrides(input.acmeEmail, managedDomainTls),
    ...buildCustomTlsOverrides(),
    ...buildSelfHostedRuntimeOverrides(input),
    ...buildSelfHostedImageOverrides(input.runtimeSelection.imageRefs),
  };
}

function buildManagedDomainTlsOverrides(
  acmeEmail: string,
  managedDomainTls: ManagedDomainTlsEnvironment | null,
): Record<string, string> {
  return {
    COMPARTMENT_ACME_CA_URL: managedDomainTls === null ? '' : selfHostedManagedAcmeCaUrl,
    COMPARTMENT_ACME_EMAIL: acmeEmail,
    COMPARTMENT_CADDY_TLS_MODE:
      managedDomainTls === null ? selfHostedInternalCaddyTlsMode : selfHostedManagedCaddyTlsMode,
    COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: managedDomainTls?.brokerToken ?? '',
    COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: managedDomainTls?.brokerUrl ?? '',
    COMPARTMENT_PUBLIC_PROTOCOL: 'https',
  };
}

function buildSelfHostedRuntimeOverrides(input: BuildSelfHostedEnvironmentInput): Record<string, string> {
  return {
    COMPARTMENT_BASE_DOMAIN: input.baseDomain,
    ...buildArtifactRegistryOverrides(),
    ...buildArtifactRegistryCredentialOverrides(input),
    COMPARTMENT_DATABASE_URL: `postgresql://postgres:${input.postgresPassword}@postgres:5432/compartment`,
    COMPARTMENT_DOCKER_NAMESPACE: defaultSelfHostedDockerNamespace,
    COMPARTMENT_DOCKER_WORK_DIR: input.dockerWorkDirectory,
    COMPARTMENT_EDGE_TOKEN: input.edgeToken,
    ...buildNodeAgentOverrides(input),
    ...buildSelfHostedSecretOverrides(input),
    COMPARTMENT_PUBLIC_HTTP_PORT: String(input.publicHttpPort),
    COMPARTMENT_PUBLIC_HTTPS_PORT: String(input.publicHttpsPort),
    COMPARTMENT_PUBLIC_INGRESS_IPV4: input.publicIngressIpv4,
    COMPARTMENT_PUBLIC_INGRESS_IPV6: input.publicIngressIpv6,
    COMPARTMENT_POSTGRES_PASSWORD: input.postgresPassword,
    COMPARTMENT_ROLLBACK_RETENTION_LIMIT: '',
    COMPARTMENT_SYSTEM_API_SOCKET: input.systemApiSocketPath,
    ...buildAuditRetentionOverrides(),
    ...buildResourceBackupOverrides(),
    ...buildRuntimeConnectivityOverrides(),
  };
}

function buildArtifactRegistryCredentialOverrides(input: BuildSelfHostedEnvironmentInput): Record<string, string> {
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: input.artifactRegistryReadPassword,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: input.artifactRegistryReadUsername,
    COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: input.artifactRegistryWritePassword,
    COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: input.artifactRegistryWriteUsername,
  };
}

function buildNodeAgentOverrides(input: BuildSelfHostedEnvironmentInput): Record<string, string> {
  return {
    COMPARTMENT_NODE_AGENT_SOCKET: input.nodeAgentSocketPath,
    COMPARTMENT_NODE_VERSION: input.runtimeSelection.nodeVersion,
  };
}

function buildSelfHostedSecretOverrides(input: BuildSelfHostedEnvironmentInput): Record<string, string> {
  return {
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: input.runtimeControlToken,
    COMPARTMENT_SESSION_SECRET: input.sessionSecret,
    COMPARTMENT_SYSTEM_TOKEN: input.systemToken,
    COMPARTMENT_VARIABLES_MASTER_KEY: input.variablesMasterKey,
  };
}

function buildAuditRetentionOverrides(): Record<string, string> {
  return {
    ...buildAuditFileSinkOverrides(),
    COMPARTMENT_AUDIT_RETENTION_DAYS: '90',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE: '1000',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON: '0 3 * * *',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES: '100',
  };
}

function buildAuditFileSinkOverrides(): Record<string, string> {
  return {
    COMPARTMENT_AUDIT_FILE_SINK_DIR: '/var/lib/compartment/audit-logs',
    COMPARTMENT_AUDIT_FILE_SINK_ENABLED: 'false',
    COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES: '30',
    COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL: '1d',
    COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE: '64M',
  };
}

function buildArtifactRegistryOverrides(): Record<string, string> {
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: '127.0.0.1',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '39461',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry-auth',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT: '5000',
  };
}

function buildResourceBackupOverrides(): Record<string, string> {
  return {
    COMPARTMENT_RESOURCE_BACKUP_DIR: '/var/lib/compartment/resource-backups',
  };
}

function buildSelfHostedImageOverrides(imageRefs: SelfHostedImageRefs): Record<string, string> {
  return {
    COMPARTMENT_API_IMAGE: imageRefs.apiImage,
    COMPARTMENT_CADDY_IMAGE: imageRefs.caddyImage,
    COMPARTMENT_EDGE_IMAGE: imageRefs.edgeImage,
    COMPARTMENT_RUNTIME_PROBE_IMAGE: imageRefs.runtimeProbeImage,
    COMPARTMENT_WORKER_IMAGE: imageRefs.workerImage,
  };
}

function buildRuntimeConnectivityOverrides(): Record<string, string> {
  return {
    COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: 'network',
    COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: defaultRuntimeUpstreamHost,
  };
}

function readManagedDomainTlsEnvironment(input: BuildSelfHostedEnvironmentInput): ManagedDomainTlsEnvironment | null {
  const managedDomain: ManagedDomainInstallState | undefined = input.managedDomain;
  if (managedDomain === undefined) {
    return null;
  }

  return {
    brokerUrl: managedDomain.brokerUrl,
    brokerToken: managedDomain.managedDomainBrokerToken,
  };
}

function buildUpdatedSelfHostedOverrides(
  templateText: string,
  currentValues: Record<string, string>,
  canonicalOverrides: Record<string, string>,
): Record<string, string> {
  const overrides: Record<string, string> = {};

  for (const variableName of readDeclaredVariableNames(templateText)) {
    const currentValue: string | undefined = currentValues[variableName];
    if (currentValue !== undefined) {
      overrides[variableName] = currentValue;
    }
  }

  return {
    ...overrides,
    ...readUpdatedCanonicalOverrides(currentValues, canonicalOverrides),
  };
}

function renderSelfHostedEnvironment(
  templateText: string,
  overrides: Record<string, string>,
  requiredOverrides: Record<string, string>,
): RenderedSelfHostedEnvironment {
  const values: Record<string, string> = {};
  const renderedLines: string[] = renderEnvironmentLines(templateText, overrides, values);
  assertOverrideVariablesPresent(values, requiredOverrides);

  return {
    text: renderedLines.join('\n'),
    values,
  };
}

function renderEnvironmentLines(
  templateText: string,
  overrides: Record<string, string>,
  values: Record<string, string>,
): string[] {
  return templateText.split('\n').map((line: string): string => {
    const variableName: string | null = readSelfHostedEnvironmentAssignmentName(line);
    if (variableName === null) {
      return line;
    }

    const renderedValue: string = overrides[variableName] ?? readSelfHostedEnvironmentAssignmentValue(line);
    values[variableName] = renderedValue;
    return renderSelfHostedEnvironmentAssignment(variableName, renderedValue);
  });
}

function readDeclaredVariableNames(templateText: string): string[] {
  const variableNames: string[] = [];

  for (const line of templateText.split('\n')) {
    const variableName: string | null = readSelfHostedEnvironmentAssignmentName(line);
    if (variableName !== null) {
      variableNames.push(variableName);
    }
  }

  return variableNames;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function assertOverrideVariablesPresent(values: Record<string, string>, overrides: Record<string, string>): void {
  const missingVariableNames: string[] = Object.keys(overrides)
    .filter((variableName: string): boolean => values[variableName] === undefined)
    .sort(compareStrings);

  if (missingVariableNames.length === 0) {
    return;
  }

  throw new Error(
    `The bundled self-hosted env template is missing required variables: ${missingVariableNames.join(', ')}.`,
  );
}

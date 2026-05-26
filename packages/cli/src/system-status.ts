import {
  buildControlPlaneHost,
  type RollbackRetentionEffectivePolicy,
  systemStatusResponseSchema,
  type DomainPublicScheme,
  type SystemOverallStatus,
  type SystemServiceStatus,
  type SystemServiceSummary,
  type SystemStatusDomainSummary,
} from '@compartment/contracts';
import { buildControlPlaneUrl } from './compartment-url';
import { inspectSelfHostedRuntimeServices } from './docker-runtime';
import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import {
  readSelfHostedEnvironmentValues,
  readRequiredSelfHostedEnvironmentPort,
  readRequiredSelfHostedEnvironmentRawValue,
  readRequiredSelfHostedEnvironmentValue,
} from './self-hosted-env-file';
import { resolveCurrentSelfHostedRuntimeImageRegistry } from './self-hosted-runtime-selection';
import { readCanonicalNodeAgentSocketPath } from './self-hosted-host-socket-paths';
import { readRequiredSelfHostedInstall } from './self-hosted-install-read';
import type { ReadSelfHostedInstallResult } from './self-hosted-install-read.types';
import type { DockerExecutionContext, SelfHostedRuntimeServiceInspection } from './docker-runtime.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedSystemInput, SelfHostedSystemStatusResult } from './system.types';

export async function getSelfHostedSystemStatus(input: SelfHostedSystemInput): Promise<SelfHostedSystemStatusResult> {
  const checkedAt: string = new Date().toISOString();
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertSelfHostedSystemPrivileges();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);
  const environmentValues: Record<string, string> = readSelfHostedEnvironmentValues(install.environmentText);
  const services: SystemServiceSummary[] = await inspectSystemServices(
    dockerContext,
    install,
    environmentValues,
    checkedAt,
  );

  return parseSystemStatusResult(checkedAt, paths, install, environmentValues, services);
}

function parseSystemStatusResult(
  checkedAt: string,
  paths: SelfHostedPathSelection,
  install: ReadSelfHostedInstallResult,
  environmentValues: Record<string, string>,
  services: SystemServiceSummary[],
): SelfHostedSystemStatusResult {
  return systemStatusResponseSchema.parse({
    checkedAt,
    configDir: paths.configDir,
    dataDir: paths.dataDir,
    domain: readSystemStatusDomainSummary(environmentValues),
    dockerNamespace: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_DOCKER_NAMESPACE'),
    imageRegistry: resolveCurrentSelfHostedRuntimeImageRegistry(
      install.state.imageRegistry,
      install.state.imageSource,
      environmentValues,
    ),
    imageSource: install.state.imageSource,
    overallStatus: readSystemOverallStatus(services),
    rollbackRetention: readSystemRollbackRetentionPolicy(environmentValues),
    services,
  });
}

async function inspectSystemServices(
  dockerContext: DockerExecutionContext,
  install: ReadSelfHostedInstallResult,
  environmentValues: Record<string, string>,
  checkedAt: string,
): Promise<SystemServiceSummary[]> {
  const inspectedServices: SelfHostedRuntimeServiceInspection[] = await inspectSelfHostedRuntimeServices(
    dockerContext,
    {
      composePath: install.installPaths.stagedAssetPaths.composePath,
      envPath: install.installPaths.stagedAssetPaths.envPath,
      imageSource: install.state.imageSource,
      installDirectory: install.installPaths.configDir,
      localComposePath: install.installPaths.stagedAssetPaths.localComposePath,
      nodeSocketPath: readCanonicalNodeAgentSocketPath(environmentValues),
    },
  );

  return inspectedServices.map(
    (service: SelfHostedRuntimeServiceInspection): SystemServiceSummary => toSystemServiceSummary(service, checkedAt),
  );
}

function readSystemStatusDomainSummary(environmentValues: Record<string, string>): SystemStatusDomainSummary {
  const baseDomain: string = readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_BASE_DOMAIN');
  const publicProtocol: DomainPublicScheme = readSystemStatusPublicScheme(
    readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_PUBLIC_PROTOCOL'),
  );
  const controlPlanePort: number =
    publicProtocol === 'http'
      ? readRequiredSelfHostedEnvironmentPort(environmentValues, 'COMPARTMENT_PUBLIC_HTTP_PORT')
      : readRequiredSelfHostedEnvironmentPort(environmentValues, 'COMPARTMENT_PUBLIC_HTTPS_PORT');

  return {
    cliApiUrl: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_API_URL'),
    controlPlaneUrl: buildControlPlaneUrl(publicProtocol, buildControlPlaneHost(baseDomain), controlPlanePort),
  };
}

function readSystemStatusPublicScheme(value: string): DomainPublicScheme {
  if (value === 'http' || value === 'https') {
    return value;
  }

  throw new Error(`The self-hosted environment has an invalid COMPARTMENT_PUBLIC_PROTOCOL value: ${value}.`);
}

function toSystemServiceSummary(service: SelfHostedRuntimeServiceInspection, checkedAt: string): SystemServiceSummary {
  return {
    ...service,
    uptimeSeconds: readUptimeSeconds(service.startedAt, service.status, checkedAt),
  };
}

function readSystemOverallStatus(services: SystemServiceSummary[]): SystemOverallStatus {
  if (services.every(isSystemServiceReady)) {
    return 'running';
  }
  if (services.every((service: SystemServiceSummary): boolean => isSystemServiceInactive(service.status))) {
    return 'stopped';
  }

  return 'degraded';
}

function isSystemServiceReady(service: SystemServiceSummary): boolean {
  return service.status === 'running' && service.health !== 'starting' && service.health !== 'unhealthy';
}

function isSystemServiceInactive(status: SystemServiceStatus): boolean {
  return status === 'missing' || status === 'exited' || status === 'dead';
}

function readUptimeSeconds(startedAt: string | null, status: SystemServiceStatus, checkedAt: string): number | null {
  if (startedAt === null || status !== 'running') {
    return null;
  }

  const startedAtMs: number = Date.parse(startedAt);
  const checkedAtMs: number = Date.parse(checkedAt);
  if (Number.isNaN(startedAtMs) || Number.isNaN(checkedAtMs)) {
    return null;
  }

  return Math.max(0, Math.floor((checkedAtMs - startedAtMs) / 1000));
}

function readSystemRollbackRetentionPolicy(
  environmentValues: Record<string, string>,
): RollbackRetentionEffectivePolicy {
  const rawValue: string = readRequiredSelfHostedEnvironmentRawValue(
    environmentValues,
    'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
  );
  const normalizedValue: string = rawValue.trim();
  if (normalizedValue === '') {
    return {
      limit: null,
      mode: 'indefinite',
    };
  }

  const limit: number = Number.parseInt(normalizedValue, 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('The self-hosted environment has an invalid COMPARTMENT_ROLLBACK_RETENTION_LIMIT value.');
  }

  return {
    limit,
    mode: 'keep_last',
  };
}

import type {
  SystemServiceHealth,
  SystemServiceName,
  SystemServicePublishedPort,
  SystemServiceStatus,
} from '@compartment/contracts';
import { selfHostedComposeServiceNames } from './docker-runtime.service-names';
import { readJsonValue } from './json.helpers';
import type {
  ComposePsServiceCandidate,
  ComposePsServiceEntry,
  DockerInspectContainerCandidate,
  ParsedJsonObject,
  ParsedJsonValue,
} from './docker-runtime.inspect.types';

export function buildComposeArguments(
  installDirectory: string,
  envPath: string,
  composePath: string,
  localComposePath: string,
  includeLocalCompose: boolean,
): string[] {
  const composeArguments: string[] = [
    'compose',
    '--project-directory',
    installDirectory,
    '--env-file',
    envPath,
    '-f',
    composePath,
  ];
  if (includeLocalCompose) {
    composeArguments.push('-f', localComposePath);
  }

  return composeArguments;
}

export function createMissingSelfHostedRuntimeServiceInspection(serviceName: SystemServiceName): ComposePsServiceEntry {
  return {
    containerId: null,
    health: null,
    imageRef: null,
    name: serviceName,
    publishedPorts: [],
    status: 'missing',
  };
}

export function readComposePsServices(output: string): ComposePsServiceEntry[] {
  const parsedOutput: ParsedJsonValue | null = readJsonValue(output);
  if (parsedOutput !== null) {
    return readComposePsServicesFromValue(parsedOutput);
  }

  const services: ComposePsServiceEntry[] = [];
  for (const line of output.split('\n')) {
    const service: ComposePsServiceEntry | null = readComposePsService(readJsonValue(line));
    if (service !== null) {
      services.push(service);
    }
  }

  return services;
}

export function readDockerInspectContainerCandidate(output: string): DockerInspectContainerCandidate | null {
  const parsed: ParsedJsonValue | null = readJsonValue(output);
  if (Array.isArray(parsed)) {
    const candidate: DockerInspectContainerCandidate | null = isRecord(parsed[0]) ? parsed[0] : null;
    return candidate;
  }

  const candidate: DockerInspectContainerCandidate | null = isRecord(parsed) ? parsed : null;
  return candidate;
}

export function readDockerInspectStatus(value: DockerInspectContainerCandidate): SystemServiceStatus | null {
  return value.State === undefined ? null : readSystemServiceStatus(value.State.Status);
}

export function readDockerInspectHealth(value: DockerInspectContainerCandidate): SystemServiceHealth | null {
  return value.State?.Health === undefined ? null : readSystemServiceHealth(value.State.Health.Status);
}

export function readDockerInspectImageRef(value: DockerInspectContainerCandidate): string | null {
  return value.Config === undefined ? null : readOptionalText(value.Config.Image);
}

export function readDockerInspectStartedAt(value: DockerInspectContainerCandidate): string | null {
  return value.State === undefined ? null : readIsoDate(value.State.StartedAt);
}

export function readDockerInspectPublishedPorts(
  value: DockerInspectContainerCandidate,
): SystemServicePublishedPort[] | null {
  if (!isRecord(value.NetworkSettings?.Ports)) {
    return null;
  }

  const publishedPorts: SystemServicePublishedPort[] = [];
  for (const [containerPortKey, bindings] of Object.entries(value.NetworkSettings.Ports)) {
    publishedPorts.push(...readDockerInspectPortBindings(containerPortKey, bindings));
  }

  return publishedPorts;
}

function readComposePsServicesFromValue(value: ParsedJsonValue): ComposePsServiceEntry[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry: ParsedJsonValue): ComposePsServiceEntry[] => {
      const service: ComposePsServiceEntry | null = readComposePsService(entry);
      return service === null ? [] : [service];
    });
  }

  const service: ComposePsServiceEntry | null = readComposePsService(value);
  return service === null ? [] : [service];
}

function readComposePsService(value: ParsedJsonValue | null): ComposePsServiceEntry | null {
  const candidate: ComposePsServiceCandidate | null = isRecord(value) ? value : null;
  if (candidate === null || !isComposeServiceName(candidate.Service)) {
    return null;
  }

  return {
    containerId: readOptionalText(candidate.ID),
    health: readSystemServiceHealth(candidate.Health),
    imageRef: readOptionalText(candidate.Image),
    name: candidate.Service,
    publishedPorts: readComposePublishedPorts(candidate.Publishers),
    status: readSystemServiceStatus(candidate.State),
  };
}

function readComposePublishedPorts(value: ParsedJsonValue | undefined): SystemServicePublishedPort[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry: ParsedJsonValue): SystemServicePublishedPort[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const containerPort: number | null = readPositiveInteger(entry.TargetPort);
    const hostPort: number | null = readPositiveInteger(entry.PublishedPort);
    if (containerPort === null || hostPort === null) {
      return [];
    }

    return [
      {
        containerPort,
        ...(readOptionalText(entry.URL) !== null ? { hostIp: readOptionalText(entry.URL) ?? undefined } : {}),
        hostPort,
      },
    ];
  });
}

function readDockerInspectPortBindings(
  containerPortKey: string,
  bindings: ParsedJsonValue | undefined,
): SystemServicePublishedPort[] {
  const containerPort: number | null = readContainerPort(containerPortKey);
  if (containerPort === null || !Array.isArray(bindings)) {
    return [];
  }

  return bindings.flatMap((binding: ParsedJsonValue): SystemServicePublishedPort[] => {
    const portBinding: SystemServicePublishedPort | null = readDockerInspectPortBinding(binding, containerPort);
    return portBinding === null ? [] : [portBinding];
  });
}

function readDockerInspectPortBinding(
  binding: ParsedJsonValue,
  containerPort: number,
): SystemServicePublishedPort | null {
  if (!isRecord(binding)) {
    return null;
  }

  const hostPort: number | null = readPositiveInteger(binding.HostPort);
  if (hostPort === null) {
    return null;
  }

  return {
    containerPort,
    ...(readOptionalText(binding.HostIp) !== null ? { hostIp: readOptionalText(binding.HostIp) ?? undefined } : {}),
    hostPort,
  };
}

function readSystemServiceStatus(value: ParsedJsonValue | undefined): SystemServiceStatus {
  const normalizedValue: string = typeof value === 'string' ? value.toLowerCase() : '';
  switch (normalizedValue) {
    case 'running':
    case 'restarting':
    case 'created':
    case 'paused':
    case 'removing':
    case 'exited':
    case 'dead':
    case 'missing':
      return normalizedValue;
    default:
      return 'unknown';
  }
}

function readSystemServiceHealth(value: ParsedJsonValue | undefined): SystemServiceHealth | null {
  const normalizedValue: string = typeof value === 'string' ? value.toLowerCase() : '';
  switch (normalizedValue) {
    case 'healthy':
    case 'starting':
    case 'unhealthy':
      return normalizedValue;
    default:
      return null;
  }
}

function readIsoDate(value: ParsedJsonValue | undefined): string | null {
  if (typeof value !== 'string' || value === '' || value.startsWith('0001-01-01')) {
    return null;
  }

  const timestampMs: number = Date.parse(value);
  return Number.isNaN(timestampMs) ? null : new Date(timestampMs).toISOString();
}

function readContainerPort(value: string): number | null {
  const [containerPort] = value.split('/', 1);
  return readPositiveInteger(containerPort);
}

function readPositiveInteger(value: ParsedJsonValue | undefined): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    const parsedValue: number = Number.parseInt(value, 10);
    return parsedValue > 0 ? parsedValue : null;
  }

  return null;
}

function readOptionalText(value: ParsedJsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isComposeServiceName(value: ParsedJsonValue | undefined): value is SystemServiceName {
  return (
    typeof value === 'string' &&
    selfHostedComposeServiceNames.some((serviceName: SystemServiceName): boolean => serviceName === value)
  );
}

function isRecord(value: ParsedJsonValue | undefined): value is ParsedJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

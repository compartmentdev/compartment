import type {
  DockerImageInspectConfigRecord,
  DockerImageInspectExposedPortMap,
  DockerImageInspectJsonValue,
} from './docker-build.types';
import type { DockerInspectImageResult } from './docker-models';

export function parseDockerInspectImageResult(output: string, imageRef: string): DockerInspectImageResult {
  const config: DockerImageInspectConfigRecord = parseDockerImageInspectConfig(output);

  return {
    ...readDockerImageEntrypoint(config),
    exposedPorts: readDockerImageExposedPorts(config),
    imageRef,
  };
}

function parseDockerImageInspectConfig(output: string): DockerImageInspectConfigRecord {
  const config: object | null = JSON.parse(output) as object | null;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const configRecord: DockerImageInspectConfigRecord = config;
  return configRecord;
}

function readDockerImageEntrypoint(
  config: DockerImageInspectConfigRecord,
): Pick<DockerInspectImageResult, 'entrypoint'> | Record<string, never> {
  const entrypoint: DockerImageInspectJsonValue | undefined = config.Entrypoint;
  if (entrypoint === null || entrypoint === undefined || !isDockerStringArray(entrypoint)) {
    return {};
  }

  return { entrypoint };
}

function readDockerImageExposedPorts(config: DockerImageInspectConfigRecord): number[] {
  const exposedPorts: DockerImageInspectExposedPortMap | null | undefined = config.ExposedPorts;
  if (exposedPorts === null || exposedPorts === undefined) {
    return [];
  }

  return [
    ...new Set(Object.keys(exposedPorts).filter(isDockerTcpExposedPortKey).map(parseDockerExposedPortKey)),
  ].filter((port: number): boolean => Number.isFinite(port));
}

function isDockerTcpExposedPortKey(portKey: string): boolean {
  return portKey.endsWith('/tcp');
}

function parseDockerExposedPortKey(portKey: string): number {
  const [rawPort] = portKey.split('/', 1);
  return Number.parseInt(rawPort ?? '', 10);
}

function isDockerStringArray(value: DockerImageInspectJsonValue | undefined): value is string[] {
  return (
    Array.isArray(value) && value.every((item: DockerImageInspectJsonValue): item is string => typeof item === 'string')
  );
}

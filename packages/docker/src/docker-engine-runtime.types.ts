import type Docker from 'dockerode';

export type DockerExposedPortValue = Record<string, never>;
export type DockerExposedPortMap = Record<string, DockerExposedPortValue>;
export type DockerInspectPortBindings = Record<string, DockerInspectPortBinding[] | null | undefined>;

export interface DockerInspectPortBinding {
  HostIp: string;
  HostPort: string;
}

export interface DockerInspectNetworkSettings {
  Networks?: Record<string, Docker.EndpointSettings> | null | undefined;
}

export interface DockerInspectConfigRecord {
  Labels?: Record<string, string> | null | undefined;
}

export interface DockerContainerNetworkingConfig {
  EndpointsConfig: Record<string, DockerContainerNetworkingEndpoint>;
}

export interface DockerContainerNetworkingEndpoint {
  Aliases?: string[] | undefined;
}

import type { RailpackSecretFile } from './docker-build-secrets';

export type DockerImageInspectExposedPortMap = Record<string, Record<string, never>>;
export type DockerImageInspectJsonValue =
  | boolean
  | DockerImageInspectJsonObject
  | DockerImageInspectJsonValue[]
  | null
  | number
  | string;

export interface DockerImageInspectJsonObject {
  [key: string]: DockerImageInspectJsonValue | undefined;
}

export interface DockerImageInspectConfigRecord {
  Entrypoint?: DockerImageInspectJsonValue | undefined;
  ExposedPorts?: DockerImageInspectExposedPortMap | null | undefined;
}

export interface RailpackPlanPaths {
  infoPath: string;
  planPath: string;
}

export interface RailpackBuildSecrets {
  railpackConfigEnv: Record<string, string>;
  secretFiles: RailpackSecretFile[];
}

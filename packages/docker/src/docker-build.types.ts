import type { RailpackSecretFile } from './docker-build-secrets';

export type DockerImageInspectExposedPortMap = Record<string, Record<string, never>>;

export interface DockerImageInspectConfigRecord {
  Entrypoint?: string[] | null | undefined;
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

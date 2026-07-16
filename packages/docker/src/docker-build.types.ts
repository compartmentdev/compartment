import type { RailpackSecretFile } from './docker-build-secrets';

export interface RailpackPlanPaths {
  infoPath: string;
  planPath: string;
}

export interface RailpackBuildSecrets {
  railpackConfigEnv: Record<string, string>;
  secretFiles: RailpackSecretFile[];
}

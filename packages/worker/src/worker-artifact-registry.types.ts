export interface WorkerArtifactRegistryConfig {
  address: string;
  internalUrl: string;
  mode: WorkerArtifactRegistryMode;
  readCredentials: WorkerArtifactRegistryCredentials;
  writeCredentials: WorkerArtifactRegistryCredentials;
}

export type WorkerArtifactRegistryMode = 'bundled' | 'external';

export interface WorkerArtifactRegistryCredentials {
  password: string;
  username: string;
}

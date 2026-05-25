export interface WorkerArtifactRegistryConfig {
  address: string;
  internalUrl: string;
  readCredentials: WorkerArtifactRegistryCredentials;
  writeCredentials: WorkerArtifactRegistryCredentials;
}

export interface WorkerArtifactRegistryCredentials {
  password: string;
  username: string;
}

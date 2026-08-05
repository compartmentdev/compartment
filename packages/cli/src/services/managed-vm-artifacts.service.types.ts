export interface ManagedVmDownloadedArtifacts extends ManagedVmPreparedBaseArtifacts, ManagedVmPreparedGvisorArtifacts {
  directory: string;
}

export interface ManagedVmPreparedBaseArtifacts {
  certManagerManifestPath: string;
  helmPath: string;
  k3sInstallScriptPath: string;
  k3sPath: string;
}

export interface ManagedVmPreparedGvisorArtifacts {
  gvisorCheckpointGoferPath: string;
  gvisorContainerdShimPath: string;
  gvisorMetricServerPath: string;
  gvisorRunscConfigPath: string;
  gvisorRunscPath: string;
}

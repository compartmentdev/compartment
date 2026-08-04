export interface ManagedVmDownloadedArtifacts {
  certManagerManifestPath: string;
  directory: string;
  gvisorBinDirectory: string;
  gvisorContainerdShimPath: string;
  gvisorRunscPath: string;
  helmPath: string;
  k3sInstallScriptPath: string;
  k3sPath: string;
}

export interface ManagedVmPreparedBaseArtifacts {
  certManagerManifestPath: string;
  helmPath: string;
  k3sInstallScriptPath: string;
  k3sPath: string;
}

export interface ManagedVmPreparedGvisorArtifacts {
  gvisorBinDirectory: string;
  gvisorContainerdShimPath: string;
  gvisorRunscPath: string;
}

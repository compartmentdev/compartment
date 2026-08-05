export interface ManagedVmSystemStatus {
  installationId: string;
  k3sActive: boolean;
  k3sVersion: string;
  provisionerStage: string;
}

export interface ManagedVmDiagnoseResult {
  bundlePath: string;
}

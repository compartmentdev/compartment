import type { InstallResponse } from '@compartment/contracts';

export interface DevInstallResult extends InstallResponse {
  apiUrl: string;
  configDir: string;
  dataDir: string;
}

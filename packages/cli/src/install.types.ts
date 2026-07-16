import type { InstallResponse } from '@compartment/contracts';

export interface CliInstallResult extends InstallResponse {
  apiUrl: string;
}

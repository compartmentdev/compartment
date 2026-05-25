import type { OrganizationSummary } from './organizations.contract';

export interface CliRemoteSummary {
  apiUrl: string;
  currentOrganization: OrganizationSummary | null;
  name: string;
}

export interface CliRemoteListResponse {
  currentRemote: string | null;
  remotes: CliRemoteSummary[];
}

export interface CliRemoteResponse {
  remote: CliRemoteSummary;
}

export interface CliRemoteRemoveResponse {
  remoteName: string;
}

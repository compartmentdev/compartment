export type TerminalReleaseResourceStatus = 'deleted' | 'deleting' | 'running' | 'starting' | 'stopped';

export interface TerminalReleaseResourceRow {
  failureMessage: string | null;
  name: string;
  status: TerminalReleaseResourceStatus;
}

export interface ReleaseResourceBindingRow {
  environmentId: string;
  resourceName: string;
}

export interface ReleaseResourceIdRow {
  id: string;
}

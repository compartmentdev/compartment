export type RowStatus = 'desired' | 'pending' | 'active';

export interface DesiredSpec {
  image: string;
  replicas: number;
  env: Record<string, string>;
}

export interface Row {
  id: string;
  desiredSpec: DesiredSpec;
  status: RowStatus;
  observedAt: string | null;
  jobResult?: string;
}

export interface Database {
  rows: Row[];
}

export interface AuditEvent {
  at: string;
  id: string;
  kind: 'conflict' | 'deleted' | 'drift' | 'informer-error';
  detail: string;
}

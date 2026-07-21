export interface ResourceDeletionFinalizationResult {
  deleteData: boolean | null;
  finalized: boolean;
}

export interface ResourceDeletionOutcomeRow {
  type: string;
}

export interface ResourceDeletionDemandRow {
  deleteDataRequested: boolean;
  environmentId: string;
  expectedClaimsJson: string;
  name: string;
}

export interface ResourceDeletionOutcomeValues {
  completedAt: Date;
  id: string;
  status: string;
  summary: string;
  targetId: string;
  targetType: string;
  type: string;
}

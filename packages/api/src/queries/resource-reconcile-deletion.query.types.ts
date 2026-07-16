export interface ResourceDeletionFinalizationResult {
  deleteData: boolean | null;
  finalized: boolean;
}

export interface ResourceDeletionOutcomeRow {
  type: string;
}

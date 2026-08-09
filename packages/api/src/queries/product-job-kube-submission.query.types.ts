export interface SubmittableProductJobRow {
  kubeJobSubmittedAt: Date | null;
  resourceIdsJson: string;
}

export interface WrittenProductJobRow {
  id: string;
}

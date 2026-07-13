export interface ProjectProvisioningClaimRow {
  leaseId: string;
  namespaceId: string;
  projectId: string;
}

export interface CompleteProjectProvisioningInput {
  failureMessage: string | null;
  leaseId: string;
  projectId: string;
  status: 'failed' | 'succeeded';
}

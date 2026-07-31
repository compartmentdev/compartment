import type { SourceBindingBranchMappingRow, SourceBindingRow, SourceRow } from '../../queries/source.query.types';

type GitHubWebhookScalar = boolean | number | string | null;
export type GitHubWebhookValue = GitHubWebhookScalar | GitHubWebhookObject | GitHubWebhookValue[];

export interface GitHubWebhookObject {
  [key: string]: GitHubWebhookValue | undefined;
}

export interface HandleGitHubSourceWebhookInput {
  body: GitHubWebhookObject;
  eventType: string;
  organizationId: string;
  providerDeliveryId: string;
  rawBody: Buffer;
  registrationId: string;
  signature: string;
}

export interface ProviderPushDeliveryInput {
  providerDeliveryId: string;
}

export interface NormalizedGitSourcePush {
  branchName: string;
  changedFilesState: PushChangedFilesState;
  commitSha: string;
  payloadJson: string;
}

export interface GitHubPushWebhookPayload extends GitHubWebhookObject {
  after: string;
  commits?: GitHubPushCommitPayload[] | undefined;
  deleted?: boolean | undefined;
  installation?: GitHubInstallationRefPayload | undefined;
  ref: string;
  repository: GitHubRepositoryWebhookPayload;
  size?: number | undefined;
}

export interface GitHubInstallationWebhookPayload extends GitHubWebhookObject {
  action: string;
  installation?: GitHubInstallationRefPayload | undefined;
  repositories_removed?: GitHubRepositoryWebhookPayload[] | undefined;
  repository?: GitHubRepositoryWebhookPayload | undefined;
}

export interface GitHubPushCommitPayload extends GitHubWebhookObject {
  added?: string[] | undefined;
  modified?: string[] | undefined;
  removed?: string[] | undefined;
}

export interface GitHubRepositoryWebhookPayload extends GitHubWebhookObject {
  id?: number | undefined;
  name?: string | undefined;
  owner?:
    | (GitHubWebhookObject & {
        login?: string | undefined;
      })
    | undefined;
}

export interface GitHubInstallationRefPayload extends GitHubWebhookObject {
  id?: number | undefined;
}

export interface PushChangedFilesState {
  changedFiles: string[];
  changedFilesComplete: boolean;
}

export interface PersistSourcePushEventInput {
  branchName: string;
  changedFilesState: PushChangedFilesState;
  commitSha: string;
  payloadJson: string;
  source: SourceRow;
}

export interface CreateBindingResolutionTasksInput {
  binding: SourceBindingRow;
  branchMappings: SourceBindingBranchMappingRow[];
  branchName: string;
  changedFilesState: PushChangedFilesState;
  commitSha: string;
  source: SourceRow;
  sourceEventId: string;
}

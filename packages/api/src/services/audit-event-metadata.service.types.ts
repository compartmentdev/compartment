import type { AuditEventExportFormat, SsoOidcProviderPreset } from '@compartment/contracts';
import type { AccessAssignmentScopeResult, AccessAssignmentSubjectResult } from './access-assignments.service.types';

export interface BuildOrganizationSettingsUpdatedAuditMetadataInput {
  auditRetentionUpdated: boolean;
  rollbackRetentionUpdated: boolean;
}

export interface BuildOrganizationAuthSettingsUpdatedAuditMetadataInput {
  localPasswordEnabled: boolean;
}

export interface BuildOrganizationUserAuditMetadataInput {
  email: string;
}

export interface BuildOrganizationRoleAuditMetadataInput {
  kind: string;
  permissionCount: number;
}

export interface BuildOrganizationGroupAuditMetadataInput {
  memberCount: number;
}

export interface BuildOrganizationGroupMemberAuditMetadataInput {
  memberEmail: string;
}

export interface BuildOrganizationAssignmentAuditMetadataInput {
  roleName: string;
  scope: AccessAssignmentScopeResult;
  subject: AccessAssignmentSubjectResult;
}

export interface BuildAuditExportCreatedAuditMetadataInput {
  format: AuditEventExportFormat;
}

export interface BuildSsoOidcProviderAuditMetadataInput {
  key: string;
  preset: SsoOidcProviderPreset;
}

export interface BuildGitSourceAuditMetadataInput {
  defaultBranchName: string;
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface BuildGitSourceSettingsAuditMetadataInput {
  autoAdoptNewApps: boolean;
}

export interface BuildGitSourceDescriptorAuditMetadataInput {
  descriptorPath: string;
}

export interface BuildGitSourceSyncAuditMetadataInput {
  requestedBranchName: string;
  resolvedCommitSha?: string | undefined;
  taskId: string;
}

export interface BuildGitSourceBindingAuditMetadataInput {
  autoDeployEnabled: boolean;
  branchName: string;
  descriptorPath: string;
  environmentName: string;
  projectName: string;
}

export interface BuildGitSourcePushAuditMetadataInput {
  branchName: string;
  changedFilesComplete: boolean;
  changedFilesCount: number;
  commitSha: string;
  providerDeliveryId: string;
}

export interface BuildGitSourceAutoDeployAuditMetadataInput {
  branchName: string;
  commitSha: string;
  resolutionTaskCount: number;
}

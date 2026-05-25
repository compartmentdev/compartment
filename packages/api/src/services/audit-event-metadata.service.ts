import type { AuditEventMetadata } from '@compartment/contracts';
import type {
  BuildAuditExportCreatedAuditMetadataInput,
  BuildGitSourceAutoDeployAuditMetadataInput,
  BuildGitSourceAuditMetadataInput,
  BuildGitSourceBindingAuditMetadataInput,
  BuildGitSourceDescriptorAuditMetadataInput,
  BuildGitSourcePushAuditMetadataInput,
  BuildGitSourceSettingsAuditMetadataInput,
  BuildGitSourceSyncAuditMetadataInput,
  BuildOrganizationAssignmentAuditMetadataInput,
  BuildOrganizationAuthSettingsUpdatedAuditMetadataInput,
  BuildOrganizationGroupAuditMetadataInput,
  BuildOrganizationGroupMemberAuditMetadataInput,
  BuildOrganizationRoleAuditMetadataInput,
  BuildOrganizationSettingsUpdatedAuditMetadataInput,
  BuildOrganizationUserAuditMetadataInput,
  BuildSsoOidcProviderAuditMetadataInput,
} from './audit-event-metadata.service.types';

const forbiddenAuditMetadataKeyPattern: RegExp =
  /(^|[._-])(archive|authorization|ciphertext|client_secret|compose|cookie|env|header|hash|password|payload|private_key|secret|token|webhook)([._-]|$)/iu;
const allowedSensitiveAdjacentAuditMetadataKeys: ReadonlySet<string> = new Set(['localPasswordEnabled']);

export function sanitizeAuditEventMetadata(metadata: AuditEventMetadata): AuditEventMetadata {
  const sanitized: AuditEventMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isForbiddenAuditMetadataKey(key)) {
      throw new Error(`Audit event metadata key "${key}" is forbidden.`);
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function isForbiddenAuditMetadataKey(key: string): boolean {
  if (allowedSensitiveAdjacentAuditMetadataKeys.has(key)) {
    return false;
  }

  return forbiddenAuditMetadataKeyPattern.test(normalizeAuditMetadataKey(key));
}

function normalizeAuditMetadataKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

export function buildOrganizationSettingsUpdatedAuditMetadata(
  input: BuildOrganizationSettingsUpdatedAuditMetadataInput,
): AuditEventMetadata {
  return {
    auditRetentionUpdated: input.auditRetentionUpdated,
    rollbackRetentionUpdated: input.rollbackRetentionUpdated,
  };
}

export function buildOrganizationAuthSettingsUpdatedAuditMetadata(
  input: BuildOrganizationAuthSettingsUpdatedAuditMetadataInput,
): AuditEventMetadata {
  return {
    localPasswordEnabled: input.localPasswordEnabled,
  };
}

export function buildOrganizationUserAuditMetadata(input: BuildOrganizationUserAuditMetadataInput): AuditEventMetadata {
  return {
    email: input.email,
  };
}

export function buildOrganizationRoleAuditMetadata(input: BuildOrganizationRoleAuditMetadataInput): AuditEventMetadata {
  return {
    kind: input.kind,
    permissionCount: input.permissionCount,
  };
}

export function buildOrganizationGroupAuditMetadata(
  input: BuildOrganizationGroupAuditMetadataInput,
): AuditEventMetadata {
  return {
    memberCount: input.memberCount,
  };
}

export function buildOrganizationGroupMemberAuditMetadata(
  input: BuildOrganizationGroupMemberAuditMetadataInput,
): AuditEventMetadata {
  return {
    memberEmail: input.memberEmail,
  };
}

export function buildOrganizationAssignmentAuditMetadata(
  input: BuildOrganizationAssignmentAuditMetadataInput,
): AuditEventMetadata {
  return {
    roleName: input.roleName,
    scopeType: input.scope.scopeType,
    subjectType: input.subject.subjectType,
  };
}

export function buildAuditExportCreatedAuditMetadata(
  input: BuildAuditExportCreatedAuditMetadataInput,
): AuditEventMetadata {
  return {
    format: input.format,
  };
}

export function buildSsoOidcProviderAuditMetadata(input: BuildSsoOidcProviderAuditMetadataInput): AuditEventMetadata {
  return {
    key: input.key,
    preset: input.preset,
  };
}

export function buildGitSourceAuditMetadata(input: BuildGitSourceAuditMetadataInput): AuditEventMetadata {
  return {
    defaultBranchName: input.defaultBranchName,
    providerHost: input.providerHost,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
  };
}

export function buildGitSourceSettingsAuditMetadata(
  input: BuildGitSourceSettingsAuditMetadataInput,
): AuditEventMetadata {
  return {
    autoAdoptNewApps: input.autoAdoptNewApps,
  };
}

export function buildGitSourceDescriptorAuditMetadata(
  input: BuildGitSourceDescriptorAuditMetadataInput,
): AuditEventMetadata {
  return {
    descriptorPath: input.descriptorPath,
  };
}

export function buildGitSourceSyncAuditMetadata(input: BuildGitSourceSyncAuditMetadataInput): AuditEventMetadata {
  return {
    requestedBranchName: input.requestedBranchName,
    ...(input.resolvedCommitSha === undefined ? {} : { resolvedCommitSha: input.resolvedCommitSha }),
    taskId: input.taskId,
  };
}

export function buildGitSourceBindingAuditMetadata(input: BuildGitSourceBindingAuditMetadataInput): AuditEventMetadata {
  return {
    autoDeployEnabled: input.autoDeployEnabled,
    branchName: input.branchName,
    descriptorPath: input.descriptorPath,
    environmentName: input.environmentName,
    projectName: input.projectName,
  };
}

export function buildGitSourcePushAuditMetadata(input: BuildGitSourcePushAuditMetadataInput): AuditEventMetadata {
  return {
    branchName: input.branchName,
    changedFilesComplete: input.changedFilesComplete,
    changedFilesCount: input.changedFilesCount,
    commitSha: input.commitSha,
    providerDeliveryId: input.providerDeliveryId,
  };
}

export function buildGitSourceAutoDeployAuditMetadata(
  input: BuildGitSourceAutoDeployAuditMetadataInput,
): AuditEventMetadata {
  return {
    branchName: input.branchName,
    commitSha: input.commitSha,
    resolutionTaskCount: input.resolutionTaskCount,
  };
}

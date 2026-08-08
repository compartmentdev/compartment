import type { AuditEventType } from '@compartment/contracts';
import {
  buildGitSourceAutoDeployAuditMetadata,
  buildGitSourceBindingAuditMetadata,
  buildGitSourcePushAuditMetadata,
  buildGitSourceSyncAuditMetadata,
} from '../audit-event-metadata.service';
import type { BuildGitSourceSyncAuditMetadataInput } from '../audit-event-metadata.service.types';
import type { AuditEventActorInput, RecordOrganizationAuditEventInput } from '../audit-events.service.types';
import type { SourceRow } from '../../queries/source.query.types';
import type {
  BuildGitSourceBindingCreatedAuditEventInput,
  GitSourceSyncAuditEventStatus,
  BuildGitSourcePushAuditEventInputsInput,
  BuildGitSourceSyncAuditEventInput,
} from './git-source-audit.service.types';
import { buildGitSourceAuditTarget } from './git-source-audit-target.service';

export function buildGitSourceSyncAuditEventInput(
  input: BuildGitSourceSyncAuditEventInput,
): RecordOrganizationAuditEventInput {
  return {
    actor: buildGitSourceAutomationActor(input.source),
    executor: input.executor,
    eventType: readGitSourceSyncAuditEventType(input.status),
    metadata: buildGitSourceSyncAuditMetadata(buildGitSourceSyncAuditMetadataInput(input)),
    organizationId: input.source.organizationId,
    status: input.status,
    target: buildGitSourceAuditTarget(input.source.id, input.source.displayName),
  };
}

export function buildGitSourceBindingCreatedAuditEventInput(
  input: BuildGitSourceBindingCreatedAuditEventInput,
): RecordOrganizationAuditEventInput {
  return {
    actor: buildGitSourceAutomationActor(input.source),
    executor: input.executor,
    eventType: 'source.binding.created',
    metadata: buildGitSourceBindingAuditMetadata({
      autoDeployEnabled: input.binding.autoDeployEnabled,
      branchName: input.branchName,
      descriptorPath: input.binding.descriptorPath,
      environmentName: input.environmentName,
      projectName: input.binding.projectName,
    }),
    organizationId: input.source.organizationId,
    target: {
      displayName: input.binding.descriptorPath,
      id: input.binding.id,
      projectId: input.binding.projectId,
      type: 'source_binding',
    },
  };
}

function buildGitSourceSyncAuditMetadataInput(
  input: BuildGitSourceSyncAuditEventInput,
): BuildGitSourceSyncAuditMetadataInput {
  return {
    requestedBranchName: input.task.requestedBranchName,
    taskId: input.task.id,
    ...(input.resolvedCommitSha === undefined ? {} : { resolvedCommitSha: input.resolvedCommitSha }),
  };
}

export function buildGitSourcePushAuditEventInputs(
  input: BuildGitSourcePushAuditEventInputsInput,
): RecordOrganizationAuditEventInput[] {
  return [buildGitSourcePushReceivedAuditEvent(input), buildGitSourceAutoDeployAuditEvent(input)];
}

function buildGitSourcePushReceivedAuditEvent(
  input: BuildGitSourcePushAuditEventInputsInput,
): RecordOrganizationAuditEventInput {
  return {
    actor: buildGitSourceSystemActor(),
    executor: input.executor,
    eventType: 'source.push.received',
    metadata: buildGitSourcePushAuditMetadata({
      branchName: input.branchName,
      changedFilesComplete: input.changedFilesComplete,
      changedFilesCount: input.changedFilesCount,
      commitSha: input.commitSha,
      providerDeliveryId: input.providerDeliveryId,
    }),
    organizationId: input.source.organizationId,
    target: buildGitSourceAuditTarget(input.source.id, input.source.displayName),
  };
}

function buildGitSourceAutoDeployAuditEvent(
  input: BuildGitSourcePushAuditEventInputsInput,
): RecordOrganizationAuditEventInput {
  return {
    actor: buildGitSourceSystemActor(),
    executor: input.executor,
    eventType: readGitSourceAutoDeployAuditEventType(input.resolutionTaskCount),
    metadata: buildGitSourceAutoDeployAuditMetadata({
      branchName: input.branchName,
      commitSha: input.commitSha,
      resolutionTaskCount: input.resolutionTaskCount,
    }),
    organizationId: input.source.organizationId,
    target: buildGitSourceAuditTarget(input.source.id, input.source.displayName),
  };
}

function readGitSourceSyncAuditEventType(status: GitSourceSyncAuditEventStatus): AuditEventType {
  return status === 'succeeded' ? 'source.sync.succeeded' : 'source.sync.failed';
}

function readGitSourceAutoDeployAuditEventType(resolutionTaskCount: number): AuditEventType {
  return resolutionTaskCount > 0 ? 'source.auto_deploy.queued' : 'source.auto_deploy.skipped';
}

function buildGitSourceAutomationActor(source: SourceRow): AuditEventActorInput {
  return {
    principalId: source.automationPrincipalId,
    type: 'automation',
  };
}

function buildGitSourceSystemActor(): AuditEventActorInput {
  return {
    type: 'system',
  };
}

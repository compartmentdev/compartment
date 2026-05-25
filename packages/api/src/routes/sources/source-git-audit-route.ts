import type { FastifyRequest } from 'fastify';
import {
  buildGitSourceDescriptorAuditMetadata,
  buildGitSourceAuditMetadata,
  buildGitSourceBindingAuditMetadata,
  buildGitSourceSyncAuditMetadata,
} from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { buildGitSourceAuditTarget } from '../../services/git-source/git-source-audit-target.service';
import { readGitSource } from '../../services/git-source/git-source.service';
import type {
  ConnectGitSourceResult,
  GitSourceBindingView,
  GitSourceConnectSyncRequestView,
  GitSourceView,
} from '../../services/git-source/git-source.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import type {
  BuildGitSourceSyncRequestedAuditEventInput,
  ReadGitSourceAuditDisplayNameInput,
} from './source-git-audit-route.types';

type GitSourceAuditEventType = 'source.connected' | 'source.disconnected';

export async function readGitSourceAuditDisplayName(input: ReadGitSourceAuditDisplayNameInput): Promise<string> {
  const view: GitSourceView = await readGitSource(input);
  return view.source.displayName;
}

export async function emitGitSourceConnectResultAuditEvents(
  request: FastifyRequest,
  result: ConnectGitSourceResult,
): Promise<void> {
  if (result.sourceConnected) {
    await emitGitSourceConnectAuditEvents(request, result.view);
  }
  if (result.syncRequest !== null) {
    await emitGitSourceReconnectAuditEvents(request, result.view, result.syncRequest);
  }
}

async function emitGitSourceConnectAuditEvents(request: FastifyRequest, view: GitSourceView): Promise<void> {
  await recordAuditEvent(buildAuditEventForRequest(request, buildGitSourceAuditEventInput(view, 'source.connected')));
  for (const binding of view.bindings) {
    await recordAuditEvent(buildAuditEventForRequest(request, buildGitSourceBindingAuditEventInput(binding)));
  }
}

export async function emitGitSourceDisconnectAuditEvent(request: FastifyRequest, view: GitSourceView): Promise<void> {
  await recordAuditEvent(
    buildAuditEventForRequest(request, buildGitSourceAuditEventInput(view, 'source.disconnected')),
  );
}

async function emitGitSourceReconnectAuditEvents(
  request: FastifyRequest,
  view: GitSourceView,
  syncRequest: GitSourceConnectSyncRequestView,
): Promise<void> {
  for (const auditEvent of buildGitSourceReconnectAuditEventInputs(view, syncRequest)) {
    await recordAuditEvent(buildAuditEventForRequest(request, auditEvent));
  }
}

function buildGitSourceReconnectAuditEventInputs(
  view: GitSourceView,
  syncRequest: GitSourceConnectSyncRequestView,
): RouteAuditEventInput[] {
  return [
    ...readGitSourceReconnectDescriptorAuditEventInputs(view.source.id, syncRequest.descriptorPath),
    buildGitSourceSyncRequestedAuditEventInput({
      requestedBranchName: syncRequest.requestedBranchName,
      sourceDisplayName: view.source.displayName,
      sourceId: view.source.id,
      taskId: syncRequest.taskId,
    }),
  ];
}

function readGitSourceReconnectDescriptorAuditEventInputs(
  sourceId: string,
  descriptorPath: string | undefined,
): RouteAuditEventInput[] {
  if (descriptorPath === undefined) {
    return [];
  }

  return [buildGitSourceDescriptorAuditEventInput(sourceId, descriptorPath, 'source.descriptor.included')];
}

export function buildGitSourceDescriptorAuditEventInput(
  sourceId: string,
  descriptorPath: string,
  eventType: 'source.descriptor.excluded' | 'source.descriptor.included',
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildGitSourceDescriptorAuditMetadata({ descriptorPath }),
    target: {
      displayName: descriptorPath,
      id: `${sourceId}:${descriptorPath}`,
      type: 'source_descriptor',
    },
  };
}

export function buildGitSourceSyncRequestedAuditEventInput({
  requestedBranchName,
  sourceDisplayName,
  sourceId,
  taskId,
}: BuildGitSourceSyncRequestedAuditEventInput): RouteAuditEventInput {
  return {
    eventType: 'source.sync.requested',
    metadata: buildGitSourceSyncAuditMetadata({ requestedBranchName, taskId }),
    target: buildGitSourceAuditTarget(sourceId, sourceDisplayName),
  };
}

function buildGitSourceAuditEventInput(view: GitSourceView, eventType: GitSourceAuditEventType): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildGitSourceAuditMetadata({
      defaultBranchName: view.source.defaultBranchName,
      providerHost: view.source.providerHost,
      repositoryName: view.source.repositoryName,
      repositoryOwner: view.source.repositoryOwner,
    }),
    target: buildGitSourceAuditTarget(view.source.id, view.source.displayName),
  };
}

function buildGitSourceBindingAuditEventInput(binding: GitSourceBindingView): RouteAuditEventInput {
  return {
    eventType: 'source.binding.created',
    metadata: buildGitSourceBindingAuditMetadata({
      autoDeployEnabled: binding.autoDeployEnabled,
      branchName: binding.branchName,
      descriptorPath: binding.descriptorPath,
      environmentName: binding.environmentName,
      projectName: binding.projectName,
    }),
    target: {
      displayName: binding.descriptorPath,
      id: binding.id,
      projectId: binding.projectId,
      type: 'source_binding',
    },
  };
}

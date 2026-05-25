import type { AppRouteAccessMode } from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import type { CreateQueuedDeploymentBatchDeploymentInput } from '../src/queries/deployments.query.types';
import type { DeploymentSourceProvenance } from '../src/services/deployments.service.types';
import { buildQueuedDeploymentBaseInput } from '../src/services/queued-deployment-input.service';

describe('buildQueuedDeploymentBaseInput', (): void => {
  it('returns queued deployment input without source provenance when omitted', (): void => {
    const queuedInput: CreateQueuedDeploymentBatchDeploymentInput = buildQueuedDeploymentBaseInput(createBaseInput());

    expect(queuedInput.sourceAutomationPrincipalId).toBeUndefined();
    expect(queuedInput.sourceBindingId).toBeUndefined();
    expect(queuedInput.sourceResolutionTaskId).toBeUndefined();
  });

  it('copies complete source provenance into queued deployment input', (): void => {
    const queuedInput: CreateQueuedDeploymentBatchDeploymentInput = buildQueuedDeploymentBaseInput({
      ...createBaseInput(),
      ...createSourceProvenanceInput(),
    });

    expect(queuedInput.sourceAutomationPrincipalId).toBe('prn_git_source');
    expect(queuedInput.sourceBindingId).toBe('sbd_123');
    expect(queuedInput.sourceBindingSnapshotJson).toBe('{"bindingId":"sbd_123"}');
    expect(queuedInput.sourceCommitSha).toBe('sha_123');
    expect(queuedInput.sourceEventId).toBe('sev_123');
    expect(queuedInput.sourceId).toBe('src_123');
    expect(queuedInput.sourceKind).toBe('git');
    expect(queuedInput.sourceRepositorySnapshotJson).toBe('{"owner":"acme","name":"mono"}');
    expect(queuedInput.sourceResolutionTaskId).toBe('srt_123');
  });

  it('rejects partial source provenance input', (): void => {
    expect((): void => {
      buildQueuedDeploymentBaseInput({
        ...createBaseInput(),
        sourceAutomationPrincipalId: 'prn_git_source',
      });
    }).toThrow('Missing sourceBindingId for source deployment provenance.');
  });
});

interface QueuedDeploymentBaseTestInput {
  accessMode: AppRouteAccessMode;
  deploymentRunId: string;
  environmentId: string;
  nodeId: string;
  projectServiceId: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRoutesJson: string;
  resolvedRunJson: string;
}

function createBaseInput(): QueuedDeploymentBaseTestInput {
  return {
    accessMode: 'public',
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    nodeId: 'nod_123',
    projectServiceId: 'svc_123',
    resolvedReadinessJson: '{"kind":"http"}',
    resolvedReleaseJson: 'null',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{"command":"python app.py"}',
  };
}

function createSourceProvenanceInput(): SourceProvenanceTestInput {
  return {
    sourceAutomationPrincipalId: 'prn_git_source',
    sourceBindingId: 'sbd_123',
    sourceBindingSnapshotJson: '{"bindingId":"sbd_123"}',
    sourceCommitSha: 'sha_123',
    sourceEventId: 'sev_123',
    sourceId: 'src_123',
    sourceKind: 'git',
    sourceRepositorySnapshotJson: '{"owner":"acme","name":"mono"}',
    sourceResolutionTaskId: 'srt_123',
  };
}

type SourceProvenanceTestInput = DeploymentSourceProvenance;

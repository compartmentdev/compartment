import { buildResourceOutputReference } from '@compartment/contracts';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import {
  deleteEnvironmentResourceOutputVariableBindingBySourceWithAudit,
  upsertEnvironmentResourceOutputVariableBindingWithAudit,
} from '../queries/variables-resource-output.query';
import type {
  InsertVariableChangeEventInput,
  ResourceOutputBindingDeleteAuditResult,
  ResourceOutputBindingWriteAuditResult,
  UpsertEnvironmentResourceOutputVariableBindingInput,
} from '../queries/variables.query.types';
import { writeCommittedAuditEventRowsToLocalFileSink } from './audit-events.service';
import type { ResolvedDescriptorService } from './deployments.service.types';
import type {
  ApplyDescriptorServiceConnectionBindingPlanInput,
  DescriptorServiceConnectionBindingInput,
  DescriptorServiceConnectionBindingRemovalInput,
} from './deployment-service-connections.service.types';

export function assertDescriptorServiceConnectionBuildEnvIsRuntimeOnly(service: ResolvedDescriptorService): void {
  if (service.build.env.length === 0) {
    return;
  }

  const connectionKeyNames: Set<string> = new Set<string>();
  for (const connection of Object.values(service.connections)) {
    for (const keyName of Object.keys(connection.env)) {
      connectionKeyNames.add(keyName);
    }
  }

  for (const keyName of service.build.env) {
    if (!connectionKeyNames.has(keyName)) {
      continue;
    }

    throw createInvalidDeployConfigError(
      `Build variable "${keyName}" uses a descriptor resource connection. Resource outputs resolve at runtime and cannot be exposed to build.`,
    );
  }
}

export async function applyDescriptorServiceConnectionBindingPlan(
  input: ApplyDescriptorServiceConnectionBindingPlanInput,
): Promise<void> {
  for (const removal of input.plan.removals) {
    const result: ResourceOutputBindingDeleteAuditResult =
      await deleteEnvironmentResourceOutputVariableBindingBySourceWithAudit(
        {
          environmentId: removal.environmentId,
          keyName: removal.keyName,
          source: 'descriptor',
          targetServiceName: removal.serviceName,
        },
        buildRemoveDescriptorServiceConnectionChangeEventInput(input.plan.actorPrincipalId, removal),
      );
    writeCommittedAuditEventRowsToLocalFileSink(result.auditEvents);
  }

  for (const binding of input.plan.upserts) {
    const result: ResourceOutputBindingWriteAuditResult = await upsertEnvironmentResourceOutputVariableBindingWithAudit(
      buildDescriptorServiceConnectionBindingInput(input.plan.actorPrincipalId, binding),
      buildSetDescriptorServiceConnectionChangeEventInput(input.plan.actorPrincipalId, binding),
    );
    writeCommittedAuditEventRowsToLocalFileSink(result.auditEvents);
  }
}

function buildDescriptorServiceConnectionBindingInput(
  actorPrincipalId: string,
  binding: DescriptorServiceConnectionBindingInput,
): UpsertEnvironmentResourceOutputVariableBindingInput {
  const now: Date = new Date();

  return {
    createdByPrincipalId: actorPrincipalId,
    environmentId: binding.environmentId,
    id: createId('vrob'),
    keyName: binding.keyName,
    outputName: binding.outputName,
    resourceName: binding.resourceName,
    source: 'descriptor',
    targetServiceName: binding.serviceName,
    updatedAt: now,
    updatedByPrincipalId: actorPrincipalId,
  };
}

function buildSetDescriptorServiceConnectionChangeEventInput(
  actorPrincipalId: string,
  binding: DescriptorServiceConnectionBindingInput,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId,
    fingerprintsJson: JSON.stringify([buildResourceOutputReference(binding)]),
    keyNamesJson: JSON.stringify([binding.keyName]),
    operation: 'set',
    organizationId: binding.organizationId,
    sensitivityJson: JSON.stringify(['resource_output']),
    targetId: binding.targetServiceId,
    targetType: 'service',
  };
}

function buildRemoveDescriptorServiceConnectionChangeEventInput(
  actorPrincipalId: string,
  removal: DescriptorServiceConnectionBindingRemovalInput,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId,
    keyNamesJson: JSON.stringify([removal.keyName]),
    operation: 'remove',
    organizationId: removal.organizationId,
    targetId: removal.targetServiceId,
    targetType: 'service',
  };
}

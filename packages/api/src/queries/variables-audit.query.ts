import type { AuditEventMetadata } from '@compartment/contracts';
import { eq } from 'drizzle-orm';
import { principals } from '../db/schema';
import { insertAuditEventWithExecutor } from './audit-events.query';
import type { AuditEventRow } from './audit-events.query.types';
import type { InsertVariableAuditEventInput, InsertVariableChangeEventInput } from './variables.query.types';
import { insertVariableChangeEventWithExecutor, type VariablesWriteExecutor } from './variables.query.write.helpers';

interface VariableAuditActorRow {
  email: string;
  type: string;
}

export async function insertVariableChangeAuditEventsWithExecutor(
  tx: VariablesWriteExecutor,
  changeEvent: InsertVariableChangeEventInput,
): Promise<AuditEventRow[]> {
  await insertVariableChangeEventWithExecutor(tx, changeEvent);
  return await insertVariableAuditEventsWithExecutor(tx, changeEvent.actorPrincipalId, changeEvent.auditEvents ?? []);
}

export async function insertVariableAuditEventsWithExecutor(
  tx: VariablesWriteExecutor,
  actorPrincipalId: string,
  events: readonly InsertVariableAuditEventInput[],
): Promise<AuditEventRow[]> {
  if (events.length === 0) {
    return [];
  }
  const actor: VariableAuditActorRow = await requireVariableAuditActor(tx, actorPrincipalId);
  return await Promise.all(
    events.map(
      async (event: InsertVariableAuditEventInput): Promise<AuditEventRow> =>
        await insertVariableAuditEvent(tx, actorPrincipalId, actor, event),
    ),
  );
}

async function insertVariableAuditEvent(
  tx: VariablesWriteExecutor,
  actorPrincipalId: string,
  actor: VariableAuditActorRow,
  event: InsertVariableAuditEventInput,
): Promise<AuditEventRow> {
  return await insertAuditEventWithExecutor(tx, {
    actorEmail: actor.email,
    actorPrincipalId,
    actorType: actor.type === 'automation' ? 'automation' : 'user',
    environmentId: event.environmentId,
    eventType: 'variable.changed',
    metadata: buildVariableAuditMetadata(event),
    organizationId: event.organizationId,
    projectId: event.projectId,
    projectServiceId: event.projectServiceId,
    scopeType: 'organization',
    status: 'succeeded',
    targetDisplayName: event.keyName,
    targetId: event.keyName,
    targetType: 'variable',
  });
}

async function requireVariableAuditActor(
  tx: VariablesWriteExecutor,
  principalId: string,
): Promise<VariableAuditActorRow> {
  const [actor] = await tx
    .select({ email: principals.email, type: principals.type })
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1);
  if (actor === undefined) {
    throw new Error(`Variable audit actor ${principalId} was not found.`);
  }
  return actor;
}

function buildVariableAuditMetadata(event: InsertVariableAuditEventInput): AuditEventMetadata {
  return {
    action: event.action,
    keyName: event.keyName,
    resourceName: event.resourceName,
    serviceName: event.serviceName,
    ...(event.sensitivity === undefined ? {} : { sensitivity: event.sensitivity }),
  };
}

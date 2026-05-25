import type { AuditEventTargetInput } from '../audit-events.service.types';

export function buildGitSourceAuditTarget(sourceId: string, displayName: string): AuditEventTargetInput {
  return {
    displayName,
    id: sourceId,
    type: 'source',
  };
}

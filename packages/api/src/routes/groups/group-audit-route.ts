import {
  buildOrganizationGroupAuditMetadata,
  buildOrganizationGroupMemberAuditMetadata,
} from '../../services/audit-event-metadata.service';
import type { AuditEventTargetInput } from '../../services/audit-events.service.types';
import type { AccessGroupResult } from '../../services/access-groups.service.types';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';

type GroupAuditEventType = 'organization.group.created' | 'organization.group.deleted' | 'organization.group.updated';
type GroupMemberAuditEventType = 'organization.group.member_added' | 'organization.group.member_removed';

export function buildGroupAuditEventInput(
  group: AccessGroupResult,
  eventType: GroupAuditEventType,
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildOrganizationGroupAuditMetadata({ memberCount: group.memberCount }),
    target: toGroupAuditTarget(group),
  };
}

export function buildGroupMemberAuditEventInput(
  group: AccessGroupResult,
  email: string,
  eventType: GroupMemberAuditEventType,
): RouteAuditEventInput {
  return {
    eventType,
    metadata: buildOrganizationGroupMemberAuditMetadata({ memberEmail: email }),
    target: toGroupAuditTarget(group),
  };
}

function toGroupAuditTarget(group: AccessGroupResult): AuditEventTargetInput {
  return {
    displayName: group.name,
    id: group.id,
    type: 'group',
  };
}

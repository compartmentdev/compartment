import { count, sql, type SQL } from 'drizzle-orm';
import { accessAssignments, accessGroupMemberships, accessGroups } from '../db/schema';
import type {
  AccessGroupAggregateRow,
  AccessGroupMemberQueryRow,
  AccessGroupMemberRow,
  AccessGroupRow,
} from './rbac.query.types';

export function toAccessGroupMemberRow(row: AccessGroupMemberQueryRow): AccessGroupMemberRow {
  return {
    email: row.email,
    id: row.id,
    status: row.passwordHash !== null ? 'active' : 'invited',
  };
}

export function readAccessGroupAggregateSelection(): {
  assignmentCount: SQL<number>;
  createdAt: typeof accessGroups.createdAt;
  description: typeof accessGroups.description;
  id: typeof accessGroups.id;
  memberCount: SQL<number>;
  name: typeof accessGroups.name;
  organizationId: typeof accessGroups.organizationId;
  updatedAt: typeof accessGroups.updatedAt;
} {
  return {
    assignmentCount: count(sql`distinct ${accessAssignments.id}`),
    createdAt: accessGroups.createdAt,
    description: accessGroups.description,
    id: accessGroups.id,
    memberCount: count(sql`distinct ${accessGroupMemberships.id}`),
    name: accessGroups.name,
    organizationId: accessGroups.organizationId,
    updatedAt: accessGroups.updatedAt,
  };
}

export function toAccessGroupRow(row: AccessGroupAggregateRow): AccessGroupRow {
  return {
    assignmentCount: row.assignmentCount,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    memberCount: row.memberCount,
    name: row.name,
    organizationId: row.organizationId,
    updatedAt: row.updatedAt,
  };
}

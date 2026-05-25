import type { accessAssignments } from '../db/schema';
import type {
  AccessAssignmentRow,
  AccessAssignmentScopeTypeValue,
  AccessAssignmentSubjectTypeValue,
} from './rbac.query.types';

export function toAccessAssignmentRow(row: typeof accessAssignments.$inferSelect): AccessAssignmentRow {
  return {
    createdAt: row.createdAt,
    id: row.id,
    organizationId: row.organizationId,
    roleId: row.roleId,
    scopeId: row.scopeId,
    scopeType: row.scopeType as AccessAssignmentScopeTypeValue,
    subjectId: row.subjectId,
    subjectType: row.subjectType as AccessAssignmentSubjectTypeValue,
  };
}

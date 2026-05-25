import type { AuditEventType } from '@compartment/contracts';
import { z } from 'zod';

export type OrganizationAssignmentAuditEventType = Extract<
  AuditEventType,
  'organization.assignment.created' | 'organization.assignment.deleted'
>;

export interface AssignmentRouteParams {
  assignmentId: string;
}

export const assignmentRouteParamsSchema: z.ZodType<AssignmentRouteParams> = z
  .object({
    assignmentId: z.string().min(1),
  })
  .strict();

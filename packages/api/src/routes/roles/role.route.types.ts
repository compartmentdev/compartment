import type { AuditEventType } from '@compartment/contracts';
import { z } from 'zod';

export type OrganizationRoleAuditEventType = Extract<
  AuditEventType,
  'organization.role.created' | 'organization.role.deleted' | 'organization.role.updated'
>;

export interface RoleRouteParams {
  roleId: string;
}

export const roleRouteParamsSchema: z.ZodType<RoleRouteParams> = z
  .object({
    roleId: z.string().min(1),
  })
  .strict();

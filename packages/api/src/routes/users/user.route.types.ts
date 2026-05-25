import type { AuditEventType } from '@compartment/contracts';
import { z } from 'zod';

export type OrganizationUserAccessAuditEventType = Extract<
  AuditEventType,
  'organization.user.blocked' | 'organization.user.unblocked'
>;

export interface UserRouteParams {
  email: string;
}

export const userRouteParamsSchema: z.ZodType<UserRouteParams> = z
  .object({
    email: z.string().email(),
  })
  .strict();

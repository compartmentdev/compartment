import { z } from 'zod';

export interface GroupRouteParams {
  groupId: string;
}

export interface GroupMemberRouteParams extends GroupRouteParams {
  email: string;
}

export const groupRouteParamsSchema: z.ZodType<GroupRouteParams> = z
  .object({
    groupId: z.string().min(1),
  })
  .strict();

export const groupMemberRouteParamsSchema: z.ZodType<GroupMemberRouteParams> = z
  .object({
    email: z.string().email(),
    groupId: z.string().min(1),
  })
  .strict();

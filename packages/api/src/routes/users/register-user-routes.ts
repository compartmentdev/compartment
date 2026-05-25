import type { ApiApp } from '../../app.types';
import { registerGetUserAccessRoute } from './get-user-access.route';
import { registerDeleteUserRoute } from './delete-user.route';
import { registerGetUsersRoute } from './get-users.route';
import { registerPostInviteUserRoute } from './post-invite-user.route';
import { registerPostUserBlockRoute } from './post-user-block.route';
import { registerPostUserPasswordResetRoute } from './post-user-password-reset.route';
import { registerPostUserUnblockRoute } from './post-user-unblock.route';

export function registerUserRoutes(app: ApiApp): void {
  registerGetUsersRoute(app);
  registerGetUserAccessRoute(app);
  registerPostInviteUserRoute(app);
  registerPostUserBlockRoute(app);
  registerPostUserPasswordResetRoute(app);
  registerPostUserUnblockRoute(app);
  registerDeleteUserRoute(app);
}

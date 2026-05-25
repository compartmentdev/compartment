import type { ApiApp } from '../../app.types';
import { unblockUserInOrganization } from '../../services/organization-users.service';
import { registerPostUserAccessRoute } from './post-user-access.route.helpers';
import { userUnblockApiPathname } from './users-api-paths';

export function registerPostUserUnblockRoute(app: ApiApp): void {
  registerPostUserAccessRoute({
    auditEventType: 'organization.user.unblocked',
    app,
    mutation: unblockUserInOrganization,
    pathname: userUnblockApiPathname,
  });
}

import type { ApiApp } from '../../app.types';
import { blockUserInOrganization } from '../../services/organization-users.service';
import { registerPostUserAccessRoute } from './post-user-access.route.helpers';
import { userBlockApiPathname } from './users-api-paths';

export function registerPostUserBlockRoute(app: ApiApp): void {
  registerPostUserAccessRoute({
    auditEventType: 'organization.user.blocked',
    app,
    mutation: blockUserInOrganization,
    pathname: userBlockApiPathname,
  });
}

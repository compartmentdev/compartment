import type { FastifyPluginOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import { addNoStoreCacheControlHeader } from '../../http/no-store-response-cache';
import { registerAssignmentRoutes } from '../assignments/register-assignment-routes';
import { registerAuditEventRoutes } from '../audit/audit-events.route';
import { registerOrganizationAuthSettingsRoutes } from '../auth-settings/auth-settings.route';
import { registerPostClaimRoute } from '../auth/post-claim.route';
import { registerPostLogoutRoute } from '../auth/post-logout.route';
import { registerCustomDomainRoutes } from '../custom-domains/register-custom-domain-routes';
import { registerGetDeploymentListRoute } from '../deployments-list/get-deployment-list.route';
import { registerGetDeploymentInspectRoute } from '../deployments/get-deployment-inspect.route';
import { registerGetDeploymentLogsRoute } from '../deployments/get-deployment-logs.route';
import { registerGetDeploymentRunLogsRoute } from '../deployments/get-deployment-run-logs.route';
import { registerPostDeployRoute } from '../deployments/post-deploy.route';
import { registerPostPromoteRoute } from '../deployments/post-promote.route';
import { registerPostRollbackRoute } from '../deployments/post-rollback.route';
import { registerGetDeploymentStatusRoute } from '../deployments/get-deployment-status.route';
import { registerGetDeploymentMetricsRoute } from '../deployments/get-deployment-metrics.route';
import { registerGetWhoAmIRoute } from '../identity/get-whoami.route';
import { registerGetOrganizationsRoute } from '../organizations/get-organizations.route';
import { registerOrganizationSettingsRoutes } from '../organization-settings/organization-settings.route';
import { registerFirstDeployOnboardingRoutes } from '../onboarding/onboarding-first-deploy.route';
import { registerPostCreateOrganizationRoute } from '../organizations/post-create-organization.route';
import { registerProjectRoutes } from '../projects/register-project-routes';
import { registerResourceRoutes } from '../resources/register-resource-routes';
import { registerGroupRoutes } from '../groups/register-group-routes';
import { registerRoleRoutes } from '../roles/register-role-routes';
import { registerPostSourceUploadRoute } from '../source-uploads/post-source-upload.route';
import { registerSsoOidcProviderRoutes } from '../sso/sso-oidc-provider.route';
import { registerGitSourceRoutes } from '../sources/source-git.route';
import { registerUserRoutes } from '../users/register-user-routes';
import { registerVariableRoutes } from '../variables/register-variable-routes';
import { authenticateRequest } from './authenticate-request';
import { registerCurrentOrganizationAccessHooks } from './current-organization-route';

type RegisterProtectedRoutesDone = (err?: Error) => void;
type ProtectedRouteRegistrar = (app: ApiApp) => void;

export function registerProtectedApiRoutes(
  app: ApiApp,
  _options: FastifyPluginOptions,
  done: RegisterProtectedRoutesDone,
): void {
  app.addHook('onSend', addNoStoreCacheControlHeader);
  app.addHook('preHandler', authenticateRequest);
  registerSessionProtectedRoutes(app);
  app.register(registerCurrentOrganizationProtectedRoutes);
  done();
}

function registerSessionProtectedRoutes(app: ApiApp): void {
  const registrars: ProtectedRouteRegistrar[] = [
    registerPostClaimRoute,
    registerPostLogoutRoute,
    registerGetWhoAmIRoute,
    registerGetOrganizationsRoute,
    registerPostCreateOrganizationRoute,
  ];

  registrars.forEach((register: ProtectedRouteRegistrar): void => {
    register(app);
  });
}

function registerCurrentOrganizationProtectedRoutes(
  app: ApiApp,
  _options: FastifyPluginOptions,
  done: RegisterProtectedRoutesDone,
): void {
  registerCurrentOrganizationAccessHooks(app);
  registerCurrentOrganizationRoutes(app);
  done();
}

function registerCurrentOrganizationRoutes(app: ApiApp): void {
  currentOrganizationProtectedRouteRegistrars.forEach((register: ProtectedRouteRegistrar): void => {
    register(app);
  });
}

const currentOrganizationProtectedRouteRegistrars: ProtectedRouteRegistrar[] = [
  registerAssignmentRoutes,
  registerAuditEventRoutes,
  registerOrganizationAuthSettingsRoutes,
  registerOrganizationSettingsRoutes,
  registerCustomDomainRoutes,
  registerPostSourceUploadRoute,
  registerPostDeployRoute,
  registerPostPromoteRoute,
  registerPostRollbackRoute,
  registerGetDeploymentInspectRoute,
  registerGetDeploymentStatusRoute,
  registerGetDeploymentMetricsRoute,
  registerGetDeploymentLogsRoute,
  registerGetDeploymentRunLogsRoute,
  registerGetDeploymentListRoute,
  registerFirstDeployOnboardingRoutes,
  registerProjectRoutes,
  registerResourceRoutes,
  registerGitSourceRoutes,
  registerGroupRoutes,
  registerRoleRoutes,
  registerSsoOidcProviderRoutes,
  registerUserRoutes,
  registerVariableRoutes,
];

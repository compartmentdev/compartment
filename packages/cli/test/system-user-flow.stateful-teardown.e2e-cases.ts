import { expect, it } from 'vitest';
import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessGroupListResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  accessRoleListResponseSchema,
  accessRoleResponseSchema,
  activateResponseSchema,
  auditEventListResponseSchema,
  deploymentInspectResponseSchema,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  inviteUserResponseSchema,
  organizationUserResponseSchema,
  projectListResponseSchema,
  projectLifecycleResponseSchema,
  projectResponseSchema,
  projectShowResponseSchema,
  resourceBackupListResponseSchema,
  resourceBackupShowResponseSchema,
  resourceDeleteResponseSchema,
  resourceListResponseSchema,
  resourceLogsResponseSchema,
  resourceResponseSchema,
  resourceRestoreAsResponseSchema,
  resourceRestoreResponseSchema,
  removeUserResponseSchema,
  userListResponseSchema,
  variableGroupBindingResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  variableResponseSchema,
  whoamiCommandResponseSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessAssignmentSummary,
  type AccessGroupListResponse,
  type AccessGroupListRow,
  type AccessGroupMemberSummary,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AccessRoleListResponse,
  type AccessRoleListRow,
  type AccessRoleResponse,
  type ActivateResponse,
  type AuditEventListResponse,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentInspectResponse,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type InviteUserResponse,
  type OrganizationUserResponse,
  type OrganizationUserListRow,
  type ProjectListResponse,
  type ProjectLifecycleResponse,
  type ProjectResponse,
  type ProjectShowResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowResponse,
  type ResourceBackupSummary,
  type ResourceDeleteResponse,
  type ResourceLogLine,
  type ResourceLogsResponse,
  type ResourceRestoreAsResponse,
  type ResourceRestoreResponse,
  type ResourceListResponse,
  type ResourceResponse,
  type RemoveUserResponse,
  type UserListResponse,
  type VariableGroupBindingResponse,
  type VariableGroupUsagesResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';

import type { SelfHostedUserSetupCommandResult } from './self-hosted-user-setup-command.harness';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { expectDeploymentRuntimeImageProjection } from './self-hosted-user-setup-runtime-projection.harness';
import {
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
} from './self-hosted-user-setup.e2e.harness';
import {
  expectAppBuildMessage,
  expectAppDatabaseValue,
  expectAppEnvMessage,
  expectAppForbidden,
  expectAppLoginRejected,
  expectAppRouteNotFound,
  expectAppSessionRedirectedToLogin,
  expectAppWhoAmI,
  readAppSessionCookieWithRetry,
  writeAppDatabaseValue,
} from './self-hosted-user-setup-app-probe.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  expectAuditEvents,
  readAuditExportEventTypes,
  requireActivationToken,
  requireRouteUrl,
  requireSingleActiveDeployment,
  requireSingleInspectedActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';

import { expectAuditFileExports, expectAuditFileSinkCoverage } from './self-hosted-user-setup-audit-flow.harness';
import { expectCurrentOrganizationSlug } from './cli-response-test.harness';
import { expectK3dBackupRetentionFlow } from './self-hosted-user-setup-k3d.harness';
import { expectedAuditEventTypes, requireProjectOverview } from './system-user-flow-response.harness';

import {
  appBuildMessage,
  appListeningLogText,
  appMessage,
  afterBackupValue,
  archivedProjectMessage,
  beforeBackupValue,
  missingResourceBackupMessage,
  permissionDeniedMessage,
  renamedProjectName,
  restoredResourceName,
  rollbackBuildMessage,
  rollbackMessage,
  validSessionRequiredMessage,
  viewerEmail,
  viewerPassword,
  type SystemUserFlowContext,
} from './system-user-flow.e2e.harness';

export function registerSystemUserFlowStatefulTeardownCases(context: SystemUserFlowContext): void {
  it(
    'case 5/8: backs up and restores the app database resource',
    async (): Promise<void> => {
      const { app, admin, routeUrl, adminAppSessionCookie, completedCaseCount } = context;
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 4);
      const resourcesPayload: ResourceListResponse = await admin.runJson(
        `resource list --project ${app.projectName}`,
        resourceListResponseSchema,
      );
      expect(resourcesPayload.resources).toEqual([
        expect.objectContaining({
          name: app.resourceName,
          status: 'running',
        }),
      ]);

      const resourcePayload: ResourceResponse = await admin.runJson(
        `resource inspect --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(resourcePayload.resource.status).toBe('running');

      const resourceLogsPayload: ResourceLogsResponse = await admin.runJson(
        `resource logs --project ${app.projectName} --resource ${app.resourceName} --tail 50`,
        resourceLogsResponseSchema,
      );
      expect(resourceLogsPayload.resource.name).toBe(app.resourceName);
      expect(resourceLogsPayload.lines.length).toBeGreaterThan(0);
      expect(
        resourceLogsPayload.lines.every((line: ResourceLogLine): boolean => line.resourceName === app.resourceName),
      ).toBe(true);
      expect(resourceLogsPayload.lines.some((line: ResourceLogLine): boolean => line.stream === 'stderr')).toBe(true);

      const stoppedResourcePayload: ResourceResponse = await admin.runJson(
        `resource stop --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(stoppedResourcePayload.resource.status).toBe('stopped');

      const startedResourcePayload: ResourceResponse = await admin.runJson(
        `resource start --project ${app.projectName} --resource ${app.resourceName}`,
        resourceResponseSchema,
      );
      expect(startedResourcePayload.resource.status).toBe('running');

      const missingBackup: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `resource backup show --project ${app.projectName} --backup rbak_missing --output json`,
      );
      expect(missingBackup.stderr).toContain(missingResourceBackupMessage);

      await writeAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue, true);

      let backupId: string | undefined;
      let retentionError: Error | undefined;
      let stopAttempted = false;
      try {
        stopAttempted = true;
        const stoppedProject: ProjectLifecycleResponse = await admin.runJson(
          `project stop --project ${app.projectName}`,
          projectLifecycleResponseSchema,
        );
        expect(stoppedProject.state).toBe('stopped');
        backupId = await expectK3dBackupRetentionFlow(admin, app.directory, app.projectName, app.resourceName);
      } catch (error) {
        retentionError = error instanceof Error ? error : new Error(String(error));
      }

      let restartError: Error | undefined;
      if (stopAttempted) {
        try {
          const startedProject: ProjectLifecycleResponse = await admin.runJson(
            `project start --project ${app.projectName}`,
            projectLifecycleResponseSchema,
          );
          expect(['updating', 'running']).toContain(startedProject.state);
          await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);
          await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue, true);
        } catch (error) {
          restartError = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (retentionError !== undefined) {
        throw retentionError;
      }
      if (restartError !== undefined) {
        throw restartError;
      }
      if (backupId === undefined) {
        throw new Error('Backup retention flow completed without a backup identifier.');
      }

      const rollbackTargetStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      const activeDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        rollbackTargetStatus,
        app.serviceName,
      );
      context.activeDeployment = activeDeployment;

      const backupShowPayload: ResourceBackupShowResponse = await admin.runJson(
        `resource backup show --project ${app.projectName} --backup ${backupId}`,
        resourceBackupShowResponseSchema,
      );
      expect(backupShowPayload.backup.id).toBe(backupId);

      const backupListPayload: ResourceBackupListResponse = await admin.runJson(
        `resource backup list --project ${app.projectName} --resource ${app.resourceName}`,
        resourceBackupListResponseSchema,
      );
      expect(backupListPayload.backups.some((backup: ResourceBackupSummary): boolean => backup.id === backupId)).toBe(
        true,
      );

      await writeAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue, true);

      const restorePayload: ResourceRestoreResponse = await admin.runJson(
        `resource backup restore --project ${app.projectName} --resource ${app.resourceName} --backup ${backupId} --yes`,
        resourceRestoreResponseSchema,
      );
      expect(restorePayload.success).toBe(true);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, beforeBackupValue, true);
      await expectAppDatabaseValue(routeUrl, adminAppSessionCookie, afterBackupValue, false);
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, appMessage);

      await expectRestoreAsWithinReleasedResourceCapacity(admin, app.projectName, app.resourceName, backupId);
      context.completedCaseCount = 5;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 6/8: redeploys, rolls back, and promotes staging to production',
    async (): Promise<void> => {
      const { app, admin, routeUrl, activeDeployment, adminAppSessionCookie, completedCaseCount } = context;
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 5);
      await admin.runJson(
        `variable group put ${app.variableGroupName} E2E_MESSAGE ${rollbackMessage}`,
        variableGroupResponseSchema,
      );
      await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${rollbackBuildMessage} --env ${app.environmentName}`,
        variableResponseSchema,
        { cwd: app.directory },
      );
      await admin.runJson(
        `variable set E2E_BUILD_MESSAGE ${rollbackBuildMessage} --env staging`,
        variableResponseSchema,
        { cwd: app.directory },
      );

      const secondDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy',
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      const secondDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        secondDeployPayload,
        app.serviceName,
      );
      expect(secondDeployment.id).not.toBe(activeDeployment.id);
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, rollbackBuildMessage);

      const rollbackPayload: DeploymentStatusResponse = await admin.runJson(
        `rollback --project ${app.projectName}`,
        deploymentStatusResponseSchema,
      );
      const rolledBackDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        rollbackPayload,
        app.serviceName,
      );
      expect(rolledBackDeployment.id).not.toBe(secondDeployment.id);
      expect(rolledBackDeployment.status).toBe('succeeded');
      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      await expectAppBuildMessage(routeUrl, adminAppSessionCookie, appBuildMessage);

      await expectDeploymentRuntimeImageProjection(admin, app.projectName, app.serviceName, rolledBackDeployment.id);

      const stagingDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy --env staging',
        deployCommandResponseParser,
        { cwd: app.directory },
      );
      const stagingDeployment: DeploymentReadSummary = requireSingleActiveDeployment(
        stagingDeployPayload,
        app.serviceName,
      );
      expect(stagingDeployment.status).toBe('succeeded');

      const promotedPayload: DeploymentStatusResponse = await admin.runJson(
        `promote --project ${app.projectName} --from staging --to production`,
        deploymentStatusResponseSchema,
      );
      const promotedDeployment: DeploymentReadSummary = requireSingleActiveDeployment(promotedPayload, app.serviceName);
      expect(promotedDeployment.id).not.toBe(stagingDeployment.id);
      expect(promotedDeployment.status).toBe('succeeded');
      const promotedDeploymentId: string = promotedDeployment.id;
      context.promotedDeploymentId = promotedDeploymentId;

      const productionStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName} --env production`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireSingleActiveDeployment(productionStatus, app.serviceName).id).toBe(promotedDeployment.id);

      const stagingStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName} --env staging`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireSingleActiveDeployment(stagingStatus, app.serviceName).id).toBe(stagingDeployment.id);

      await expectAppEnvMessage(routeUrl, adminAppSessionCookie, rollbackMessage);
      context.completedCaseCount = 6;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 7/8: invites a user, grants app access, and keeps writes denied',
    async (): Promise<void> => {
      const {
        runtime,
        advertisedCompartmentUrl,
        app,
        admin,
        viewer,
        routeUrl,
        promotedDeploymentId,
        completedCaseCount,
      } = context;
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 6);
      const invitePayload: InviteUserResponse = await admin.runJson(
        `user invite ${viewerEmail}`,
        inviteUserResponseSchema,
      );
      const activationToken: string = requireActivationToken(invitePayload);

      const activationPayload: ActivateResponse = await viewer.runJson(
        `activate --api-url ${runtime.apiUrl} --email ${viewerEmail} --token ${activationToken}`,
        activateResponseSchema,
        {
          input: `${viewerPassword}\n${viewerPassword}\n`,
          interactive: true,
        },
      );
      expect(activationPayload.principal.email).toBe(viewerEmail);

      const viewerIdentity: WhoAmICommandResponse = await viewer.runJson('whoami', whoamiCommandResponseSchema);
      expect(viewerIdentity.principal.email).toBe(viewerEmail);
      expectCurrentOrganizationSlug(viewerIdentity, runtime.organizationSlug);

      const deniedViewerStatusBeforeGrant: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusBeforeGrant.stderr).toContain(permissionDeniedMessage);

      await expectAppLoginRejected(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      let viewerAppSessionCookie: string;

      const rolePayload: AccessRoleResponse = await admin.runJson(
        'role create self-hosted-e2e-app-reader --permission project.read deployment.read deployment.logs.read deployment.inspect app.route.access',
        accessRoleResponseSchema,
      );
      const shownRolePayload: AccessRoleResponse = await admin.runJson(
        `role show ${rolePayload.role.id}`,
        accessRoleResponseSchema,
      );
      expect(shownRolePayload.role.id).toBe(rolePayload.role.id);

      const updatedRolePayload: AccessRoleResponse = await admin.runJson(
        `role update ${rolePayload.role.id} --name self-hosted-e2e-app-reader-updated --permission project.read deployment.read deployment.logs.read deployment.inspect app.route.access`,
        accessRoleResponseSchema,
      );
      expect(updatedRolePayload.role.id).toBe(rolePayload.role.id);
      expect(updatedRolePayload.role.name).toBe('self-hosted-e2e-app-reader-updated');
      const updatedShownRolePayload: AccessRoleResponse = await admin.runJson(
        `role show ${rolePayload.role.id}`,
        accessRoleResponseSchema,
      );
      expect(updatedShownRolePayload.role.name).toBe('self-hosted-e2e-app-reader-updated');

      const roleListPayload: AccessRoleListResponse = await admin.runJson('role list', accessRoleListResponseSchema);
      expect(roleListPayload.roles.some((role: AccessRoleListRow): boolean => role.id === rolePayload.role.id)).toBe(
        true,
      );

      const groupPayload: AccessGroupResponse = await admin.runJson(
        'group create self-hosted-e2e-readers',
        accessGroupResponseSchema,
      );
      const groupMemberPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member add ${groupPayload.group.id} ${viewerEmail}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        groupMemberPayload.members.some((member: AccessGroupMemberSummary): boolean => member.email === viewerEmail),
      ).toBe(true);

      const groupMemberListPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member list ${groupPayload.group.id}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        groupMemberListPayload.members.some(
          (member: AccessGroupMemberSummary): boolean => member.email === viewerEmail,
        ),
      ).toBe(true);

      const groupListPayload: AccessGroupListResponse = await admin.runJson(
        'group list',
        accessGroupListResponseSchema,
      );
      expect(
        groupListPayload.groups.some((group: AccessGroupListRow): boolean => group.id === groupPayload.group.id),
      ).toBe(true);

      const assignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment create --role ${rolePayload.role.id} --scope project --project ${app.projectName} --group ${groupPayload.group.id}`,
        accessAssignmentResponseSchema,
      );
      expect(assignmentPayload.assignment.roleId).toBe(rolePayload.role.id);

      const assignmentListPayload: AccessAssignmentListResponse = await admin.runJson(
        'assignment list',
        accessAssignmentListResponseSchema,
      );
      expect(
        assignmentListPayload.assignments.some(
          (assignment: AccessAssignmentSummary): boolean => assignment.id === assignmentPayload.assignment.id,
        ),
      ).toBe(true);

      const userListPayload: UserListResponse = await admin.runJson('user list', userListResponseSchema);
      expect(userListPayload.users.map((user: OrganizationUserListRow): string => user.email)).toEqual(
        expect.arrayContaining([runtime.adminEmail, viewerEmail]),
      );

      const viewerStatusPayload: DeploymentStatusResponse = await viewer.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireRouteUrl(viewerStatusPayload, app.serviceName)).toBe(routeUrl);

      const viewerInspectPayload: DeploymentInspectResponse = await viewer.runJson(
        `inspect --project ${app.projectName}`,
        deploymentInspectResponseSchema,
      );
      expect(requireSingleInspectedActiveDeployment(viewerInspectPayload, app.serviceName).id).toBe(
        promotedDeploymentId,
      );

      const viewerRuntimeLogs: DeploymentLogsResponse = await viewer.runJson(
        `logs --project ${app.projectName}`,
        deploymentLogsResponseSchema,
      );
      expect(
        viewerRuntimeLogs.lines.some(
          (line: DeploymentLogLine): boolean =>
            line.serviceName === app.serviceName && line.message.includes(appListeningLogText),
        ),
      ).toBe(true);

      const deniedAuthSettingsWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'auth settings set --password disabled --output json',
      );
      expect(deniedAuthSettingsWrite.stderr).toContain(permissionDeniedMessage);

      const deniedVariableWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `variable group put ${app.variableGroupName} SHOULD_FAIL nope --output json`,
      );
      expect(deniedVariableWrite.stderr).toContain(permissionDeniedMessage);

      const deniedBackupWrite: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `resource backup create --project ${app.projectName} --resource ${app.resourceName} --output json`,
      );
      expect(deniedBackupWrite.stderr).toContain(permissionDeniedMessage);
      viewerAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      await expectAppWhoAmI(routeUrl, viewerAppSessionCookie, viewerEmail, runtime.organizationSlug);

      const deniedStagingDeployBeforeGrant: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'deploy --env staging --output json',
        { cwd: app.directory },
      );
      expect(deniedStagingDeployBeforeGrant.stderr).toContain(permissionDeniedMessage);

      const deployerRolePayload: AccessRoleResponse = await admin.runJson(
        'role create self-hosted-e2e-staging-deployer --permission deployment.create deployment.read',
        accessRoleResponseSchema,
      );
      const deployerAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment create --role ${deployerRolePayload.role.id} --scope environment --project ${app.projectName} --environment staging --user ${viewerEmail}`,
        accessAssignmentResponseSchema,
      );
      expect(deployerAssignmentPayload.assignment.roleId).toBe(deployerRolePayload.role.id);

      let viewerStagingDeployError: Error | undefined;
      let stagingStopAttempted = false;
      try {
        stagingStopAttempted = true;
        const stoppedStagingProject: ProjectLifecycleResponse = await admin.runJson(
          `project stop --project ${app.projectName} --env staging`,
          projectLifecycleResponseSchema,
        );
        expect(stoppedStagingProject.state).toBe('stopped');
        const viewerStagingDeployPayload: SelfHostedDeployCommandResponse = await viewer.runJson(
          'deploy --env staging',
          deployCommandResponseParser,
          { cwd: app.directory },
        );
        expect(viewerStagingDeployPayload.environment.name).toBe('staging');
        expect(requireSingleActiveDeployment(viewerStagingDeployPayload, app.serviceName).status).toBe('succeeded');
      } catch (error) {
        viewerStagingDeployError = error instanceof Error ? error : new Error(String(error));
      }
      if (viewerStagingDeployError !== undefined && stagingStopAttempted) {
        try {
          const restartedStagingProject: ProjectLifecycleResponse = await admin.runJson(
            `project start --project ${app.projectName} --env staging`,
            projectLifecycleResponseSchema,
          );
          expect(restartedStagingProject.state).toBe('updating');
        } catch {
          // Preserve the staging deployment failure as the primary error.
        }
        throw viewerStagingDeployError;
      }

      const deniedProductionDeploy: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        'deploy --env production --output json',
        { cwd: app.directory },
      );
      expect(deniedProductionDeploy.stderr).toContain(permissionDeniedMessage);

      const blockedViewerPayload: OrganizationUserResponse = await admin.runJson(
        `user block ${viewerEmail}`,
        organizationUserResponseSchema,
      );
      expect(blockedViewerPayload.user.access).toBe('blocked');

      const deniedViewerStatusAfterBlock: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusAfterBlock.stderr).toContain(validSessionRequiredMessage);
      await expectAppSessionRedirectedToLogin(
        advertisedCompartmentUrl,
        routeUrl,
        viewerAppSessionCookie,
        '/probe/whoami',
      );

      const unblockedViewerPayload: OrganizationUserResponse = await admin.runJson(
        `user unblock ${viewerEmail}`,
        organizationUserResponseSchema,
      );
      expect(unblockedViewerPayload.user.access).toBe('allowed');

      await viewer.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${viewerEmail} --output json`,
        {
          email: viewerEmail,
          password: viewerPassword,
        },
        { requestOrigin: runtime.apiUrl },
      );
      const viewerIdentityAfterUnblock: WhoAmICommandResponse = await viewer.runJson(
        'whoami',
        whoamiCommandResponseSchema,
      );
      expect(viewerIdentityAfterUnblock.principal.email).toBe(viewerEmail);

      const viewerStatusAfterUnblock: DeploymentStatusResponse = await viewer.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(requireRouteUrl(viewerStatusAfterUnblock, app.serviceName)).toBe(routeUrl);
      viewerAppSessionCookie = await readAppSessionCookieWithRetry(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });
      await expectAppWhoAmI(routeUrl, viewerAppSessionCookie, viewerEmail, runtime.organizationSlug);

      const deletedAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment delete ${assignmentPayload.assignment.id} --yes`,
        accessAssignmentResponseSchema,
      );
      expect(deletedAssignmentPayload.assignment.id).toBe(assignmentPayload.assignment.id);

      const deletedDeployerAssignmentPayload: AccessAssignmentResponse = await admin.runJson(
        `assignment delete ${deployerAssignmentPayload.assignment.id} --yes`,
        accessAssignmentResponseSchema,
      );
      expect(deletedDeployerAssignmentPayload.assignment.id).toBe(deployerAssignmentPayload.assignment.id);

      const deniedViewerStatusAfterRevoke: SelfHostedUserSetupCommandResult = await viewer.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(deniedViewerStatusAfterRevoke.stderr).toContain(permissionDeniedMessage);
      await expectAppForbidden(routeUrl, viewerAppSessionCookie, '/probe/whoami');

      const removedGroupMemberPayload: AccessGroupMemberListResponse = await admin.runJson(
        `group member remove ${groupPayload.group.id} ${viewerEmail}`,
        accessGroupMemberListResponseSchema,
      );
      expect(
        removedGroupMemberPayload.members.some(
          (member: AccessGroupMemberSummary): boolean => member.email === viewerEmail,
        ),
      ).toBe(false);

      const deletedGroupPayload: AccessGroupResponse = await admin.runJson(
        `group delete ${groupPayload.group.id} --yes`,
        accessGroupResponseSchema,
      );
      expect(deletedGroupPayload.group.id).toBe(groupPayload.group.id);

      const deletedRolePayload: AccessRoleResponse = await admin.runJson(
        `role delete ${rolePayload.role.id} --yes`,
        accessRoleResponseSchema,
      );
      expect(deletedRolePayload.role.id).toBe(rolePayload.role.id);

      const deletedDeployerRolePayload: AccessRoleResponse = await admin.runJson(
        `role delete ${deployerRolePayload.role.id} --yes`,
        accessRoleResponseSchema,
      );
      expect(deletedDeployerRolePayload.role.id).toBe(deployerRolePayload.role.id);

      const removedViewerPayload: RemoveUserResponse = await admin.runJson(
        `user remove ${viewerEmail} --yes`,
        removeUserResponseSchema,
      );
      expect(removedViewerPayload.success).toBe(true);

      const viewerAfterRemove: SelfHostedUserSetupCommandResult = await viewer.runFailure('whoami --output json');
      expect(viewerAfterRemove.stderr).not.toBe('');
      await expectAppSessionRedirectedToLogin(
        advertisedCompartmentUrl,
        routeUrl,
        viewerAppSessionCookie,
        '/probe/whoami',
      );
      context.completedCaseCount = 7;
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'case 8/8: exports audit events and archives/unarchives the project',
    async (): Promise<void> => {
      const { app, admin, routeUrl, adminAppSessionCookie, completedCaseCount } = context;
      expectSelfHostedUserSetupStepCompleted(completedCaseCount, 7);
      const unboundGroupPayload: VariableGroupBindingResponse = await admin.runJson(
        `variable unbind ${app.variableGroupName} --env ${app.environmentName}`,
        variableGroupBindingResponseSchema,
        { cwd: app.directory },
      );
      expect(unboundGroupPayload.variableGroupName).toBe(app.variableGroupName);

      const variableGroupUsagesAfterUnbind: VariableGroupUsagesResponse = await admin.runJson(
        `variable group usages ${app.variableGroupName}`,
        variableGroupUsagesResponseSchema,
      );
      expect(variableGroupUsagesAfterUnbind.usages).toEqual([]);

      await expectAuditFileSinkCoverage(admin);

      const auditPayload: AuditEventListResponse = await admin.runJson(
        'audit list --per-page 50',
        auditEventListResponseSchema,
      );
      expectAuditEvents(auditPayload, [
        'organization.user.removed',
        'organization.group.deleted',
        'organization.role.deleted',
      ]);

      for (const eventType of expectedAuditEventTypes) {
        const filteredAuditPayload: AuditEventListResponse = await admin.runJson(
          `audit list --event ${eventType} --per-page 1`,
          auditEventListResponseSchema,
        );
        expectAuditEvents(filteredAuditPayload, [eventType]);
      }

      const auditExport: SelfHostedUserSetupCommandResult = await admin.run('audit export --format ndjson --output -');
      expect(readAuditExportEventTypes(auditExport.stdout)).toEqual(
        expect.arrayContaining([...expectedAuditEventTypes]),
      );

      await expectAuditFileExports(admin, app.directory, expectedAuditEventTypes);

      const archivePayload: ProjectResponse = await admin.runJson(
        `project archive --project ${app.projectName} --yes`,
        projectResponseSchema,
      );
      expect(archivePayload.project.archivedAt).not.toBeNull();

      const archivedStatus: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `status --project ${app.projectName} --output json`,
      );
      expect(archivedStatus.stderr).toContain(archivedProjectMessage);

      const archivedDeploymentList: SelfHostedUserSetupCommandResult = await admin.runFailure(
        `deployment list --project ${app.projectName} --output json`,
      );
      expect(archivedDeploymentList.stderr).toContain(archivedProjectMessage);
      await expectAppRouteNotFound(routeUrl, adminAppSessionCookie, '/probe/whoami');

      const unarchivePayload: ProjectResponse = await admin.runJson(
        `project unarchive --project ${app.projectName}`,
        projectResponseSchema,
      );
      expect(unarchivePayload.project.archivedAt).toBeNull();

      const restoredStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${app.projectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(restoredStatus.project.name).toBe(app.projectName);
      expect(
        restoredStatus.deployments.some(
          (deployment: DeploymentReadSummary): boolean => deployment.serviceName === app.serviceName,
        ),
      ).toBe(true);

      const renamedProjectPayload: ProjectResponse = await admin.runJson(
        `project rename ${renamedProjectName} --project ${app.projectName}`,
        projectResponseSchema,
        { cwd: app.directory },
      );
      expect(renamedProjectPayload.project.name).toBe(renamedProjectName);

      const renamedProjectShow: ProjectShowResponse = await admin.runJson('project show', projectShowResponseSchema, {
        cwd: app.directory,
      });
      expect(renamedProjectShow.localProjectName).toBe(renamedProjectName);
      expect(renamedProjectShow.project?.name).toBe(renamedProjectName);

      const renamedStatus: DeploymentStatusResponse = await admin.runJson(
        `status --project ${renamedProjectName}`,
        deploymentStatusCommandResponseParser,
      );
      expect(renamedStatus.project.name).toBe(renamedProjectName);

      const projectListAfterRename: ProjectListResponse = await admin.runJson(
        'project list --full',
        projectListResponseSchema,
      );
      expect(requireProjectOverview(projectListAfterRename, renamedProjectName).name).toBe(renamedProjectName);
      context.completedCaseCount = 8;
    },
    selfHostedUserSetupTimeoutMs,
  );
}

async function expectRestoreAsWithinReleasedResourceCapacity(
  admin: SelfHostedUserSetupCli,
  projectName: string,
  resourceName: string,
  backupId: string,
): Promise<void> {
  let restoreAsError: Error | undefined;
  try {
    const stoppedOriginalResource: ResourceResponse = await admin.runJson(
      `resource stop --project ${projectName} --resource ${resourceName}`,
      resourceResponseSchema,
    );
    expect(stoppedOriginalResource.resource.status).toBe('stopped');
    const restoreAsPayload: ResourceRestoreAsResponse = await admin.runJson(
      `resource backup restore --project ${projectName} --backup ${backupId} --as ${restoredResourceName}`,
      resourceRestoreAsResponseSchema,
    );
    expect(restoreAsPayload.success).toBe(true);
    expect(restoreAsPayload.resource.name).toBe(restoredResourceName);
    expect(restoreAsPayload.resource.status).toBe('running');
  } catch (error) {
    restoreAsError = error instanceof Error ? error : new Error(String(error));
  }
  let restoredResourceDeleteError: Error | undefined;
  try {
    const deleteRestoredResourcePayload: ResourceDeleteResponse = await admin.runJson(
      `resource delete --project ${projectName} --resource ${restoredResourceName} --delete-data --yes`,
      resourceDeleteResponseSchema,
    );
    expect(deleteRestoredResourcePayload.success).toBe(true);
    expect(deleteRestoredResourcePayload.retainedVolumes).toEqual([]);
  } catch (error) {
    restoredResourceDeleteError = error instanceof Error ? error : new Error(String(error));
  }
  let resourceRestartError: Error | undefined;
  try {
    const restartedOriginalResource: ResourceResponse = await admin.runJson(
      `resource start --project ${projectName} --resource ${resourceName}`,
      resourceResponseSchema,
    );
    expect(restartedOriginalResource.resource.status).toBe('running');
  } catch (error) {
    resourceRestartError = error instanceof Error ? error : new Error(String(error));
  }
  if (restoreAsError !== undefined) {
    throw restoreAsError;
  }
  if (restoredResourceDeleteError !== undefined) {
    throw restoredResourceDeleteError;
  }
  if (resourceRestartError !== undefined) {
    throw resourceRestartError;
  }
}

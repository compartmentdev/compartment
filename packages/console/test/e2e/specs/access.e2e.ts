import { test, type ConsoleFixtures } from '../fixtures/console-test';

test.describe('console users and permissions real app', (): void => {
  test('creates users, groups, roles, and assignments through the console UI', async ({
    auditEventsPage,
    e2eAccess,
    e2eDeployment,
    groupsPage,
    loginPage,
    projectsPage,
    rolesPage,
    usersPage,
  }: ConsoleFixtures): Promise<void> => {
    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();

    await rolesPage.goto();
    await rolesPage.expectReady();
    await rolesPage.createRole(e2eAccess.roleName, e2eAccess.roleDescription, e2eAccess.rolePermissions);
    await rolesPage.openRoleDetails(e2eAccess.roleName);
    await rolesPage.expectRoleDetailsVisible(e2eAccess.roleName, e2eAccess.rolePermissions);

    await usersPage.goto();
    await usersPage.expectReady();
    await usersPage.inviteUser(e2eAccess.userEmail);

    await groupsPage.goto();
    await groupsPage.expectReady();
    await groupsPage.createGroup(e2eAccess.groupName, e2eAccess.groupDescription);
    await groupsPage.addMember(e2eAccess.groupName, e2eAccess.userEmail);
    await groupsPage.addOrganizationAssignment(e2eAccess.groupName, e2eAccess.roleName);
    await groupsPage.addEnvironmentAssignment(
      e2eAccess.groupName,
      e2eAccess.roleName,
      e2eDeployment.projectName,
      'production',
    );
    await groupsPage.expectGroupDetailsVisible(
      e2eAccess.groupName,
      e2eAccess.userEmail,
      e2eAccess.roleName,
      e2eAccess.rolePermissions,
      ['Organization', `Environment: ${e2eDeployment.projectName}/production`],
    );

    await usersPage.goto();
    await usersPage.expectReady();
    await usersPage.expectUserVisible(e2eAccess.userEmail);
    await usersPage.openUserDetails(e2eAccess.userEmail);
    await usersPage.expectUserDetailsVisible(e2eAccess.userEmail, e2eAccess.groupName, e2eAccess.rolePermissions);

    await groupsPage.goto();
    await groupsPage.expectReady();
    await groupsPage.expectGroupVisible(e2eAccess.groupName);
    await groupsPage.openGroupDetails(e2eAccess.groupName);
    await groupsPage.expectGroupDetailsVisible(
      e2eAccess.groupName,
      e2eAccess.userEmail,
      e2eAccess.roleName,
      e2eAccess.rolePermissions,
      ['Organization', `Environment: ${e2eDeployment.projectName}/production`],
    );

    await rolesPage.goto();
    await rolesPage.expectReady();
    await rolesPage.expectRoleVisible(e2eAccess.roleName);
    await rolesPage.openRoleDetails(e2eAccess.roleName);
    await rolesPage.expectRoleDetailsVisible(e2eAccess.roleName, e2eAccess.rolePermissions);
    await rolesPage.closeRoleDetails(e2eAccess.roleName);

    await auditEventsPage.openFromPrimaryNavigation();
    await auditEventsPage.expectFilteredEventTarget('organization.user.invited', e2eAccess.userEmail);
    await auditEventsPage.expectFilteredEventTarget('organization.role.created', e2eAccess.roleName);
    await auditEventsPage.expectFilteredEventTarget('organization.group.created', e2eAccess.groupName);
    await auditEventsPage.expectFilteredEventTarget('organization.group.member_added', e2eAccess.groupName);
    await auditEventsPage.expectFilteredEventTarget('organization.assignment.created', e2eAccess.roleName);
  });

  test('does not offer permissions above the role manager effective access', async ({
    e2eAccess,
    loginPage,
    projectsPage,
    rolesPage,
  }: ConsoleFixtures): Promise<void> => {
    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();

    await rolesPage.goto();
    await rolesPage.expectReady();
    await rolesPage.expectCreateRolePermissionsUnavailable(
      `${e2eAccess.roleName}-overgrant`,
      `${e2eAccess.roleDescription} overgrant regression`,
      ['deployment.create'],
      e2eAccess.rolePermissions,
    );
  });
});

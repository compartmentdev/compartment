import {
  buildCompartmentConsoleOrganizationScopedPathname,
  compartmentAssignmentScopeOptionsPathname,
  compartmentAssignmentsPathname,
  compartmentBrowserGroupsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { accessDetailDrawer } from '../support/access-drawer';
import { isSuccessfulApiMutationResponse, isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';
import { readVisibleEffectivePermissionKeys } from '../support/effective-permissions';
import { type PageReadyState, waitForPageReadyState } from '../support/page-readiness';

export class GroupsPage {
  private readonly createGroupButton: Locator;
  private readonly emptyStateMessage: Locator;
  private readonly organizationSlug: string;
  private readonly page: Page;
  private readonly searchInput: Locator;

  constructor(page: Page, organizationSlug: string) {
    this.createGroupButton = page.getByRole('button', { name: 'Create group' });
    this.emptyStateMessage = page.getByText('You do not have any groups.', { exact: true });
    this.organizationSlug = organizationSlug;
    this.page = page;
    this.searchInput = page.getByRole('searchbox', { name: 'Search groups' });
  }

  async goto(): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentGroupsPathname),
      ),
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentRolesPathname),
      ),
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAssignmentsPathname),
      ),
      this.page.waitForURL((url: URL): boolean => isConsolePathname(url, compartmentBrowserGroupsPathname)),
      this.page.goto(this.buildOrganizationPathname(compartmentBrowserGroupsPathname)),
    ]);
  }

  async expectReady(): Promise<void> {
    await expect(
      this.page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Groups/ }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(this.page.getByRole('heading', { name: 'Groups' })).toBeVisible();
    const readyState: PageReadyState = await waitForPageReadyState(this.searchInput, this.emptyStateMessage);

    if (readyState === 'content') {
      await expect(this.page.getByRole('table')).toBeVisible();
      return;
    }

    await expect(this.createGroupButton).toBeVisible();
  }

  async expectGroupVisible(groupName: string): Promise<void> {
    await expect(this.groupRow(groupName)).toBeVisible();
  }

  async createGroup(groupName: string, description: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isCreateGroupUrl(url)),
      this.createGroupButton.click(),
    ]);

    const drawer: Locator = this.detailDrawer('Create group');
    await expect(drawer.getByRole('heading', { name: 'Create group' })).toBeVisible();
    await drawer.getByLabel('Name').fill(groupName);
    await drawer.getByLabel('Description').fill(description);

    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiMutationResponse(response, compartmentGroupsPathname, 'POST'),
      ),
      this.page.waitForResponse((response: Response): boolean => this.isGroupsListResponse(response)),
      this.page.waitForResponse((response: Response): boolean => this.isGroupMembersResponse(response)),
      this.page.waitForURL((url: URL): boolean => this.isGroupDetailUrl(url)),
      drawer.getByRole('button', { name: 'Create group' }).click(),
    ]);
    await expect(this.detailDrawer(groupName)).toBeVisible();
  }

  async openGroupDetails(groupName: string): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isGroupMembersResponse(response)),
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAssignmentScopeOptionsPathname),
      ),
      this.page.waitForURL((url: URL): boolean => this.isGroupDetailUrl(url)),
      this.groupRow(groupName).getByRole('button', { name: 'Manage' }).click(),
    ]);
  }

  async expectGroupDetailsVisible(
    groupName: string,
    memberEmail: string,
    roleName: string,
    permissionKeys: PermissionKey[],
    assignmentScopeLabels: readonly string[],
  ): Promise<void> {
    const drawer: Locator = this.detailDrawer(groupName);

    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(groupName, { exact: true })).toBeVisible();
    await expect(drawer.getByText(memberEmail, { exact: true })).toBeVisible();
    for (const scopeLabel of assignmentScopeLabels) {
      await expect(this.assignmentRow(drawer, roleName, scopeLabel)).toBeVisible();
    }
    await expect(drawer.getByRole('heading', { name: 'Assignments' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Group members' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Effective permissions' })).toBeVisible();
    await expect(drawer.getByText(/effective permissions in total/u)).toBeVisible();
    await this.expectEffectivePermissionsCollapsed(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsExpanded(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsCollapsed(drawer, permissionKeys);
  }

  async addMember(groupName: string, memberEmail: string): Promise<void> {
    const drawer: Locator = this.detailDrawer(groupName);

    await drawer.getByPlaceholder('Search users by email').fill(memberEmail);
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isGroupMembersMutationResponse(response, 'POST')),
      drawer.getByRole('button', { name: 'Add member' }).click(),
    ]);
    await expect(drawer.getByText(memberEmail, { exact: true })).toBeVisible();
  }

  async addOrganizationAssignment(groupName: string, roleName: string): Promise<void> {
    const drawer: Locator = this.detailDrawer(groupName);
    const scopeSelect: Locator = drawer.getByRole('combobox').nth(0);
    const roleSelect: Locator = drawer.getByRole('combobox').nth(1);

    await selectComboboxOption(this.page, scopeSelect, 'Organization');
    await selectComboboxOption(this.page, roleSelect, roleName);
    await expect(drawer.getByRole('button', { name: 'Add assignment' })).toBeEnabled();
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiMutationResponse(response, compartmentAssignmentsPathname, 'POST'),
      ),
      drawer.getByRole('button', { name: 'Add assignment' }).click(),
    ]);
    await expect(this.assignmentRow(drawer, roleName, 'Organization')).toBeVisible();
  }

  async addEnvironmentAssignment(
    groupName: string,
    roleName: string,
    projectName: string,
    environmentName: string,
  ): Promise<void> {
    const drawer: Locator = this.detailDrawer(groupName);
    const scopeSelect: Locator = drawer.getByRole('combobox').nth(0);
    const roleSelect: Locator = drawer.getByRole('combobox').nth(1);
    const projectTrigger: Locator = this.assignmentMultiSelectTrigger(drawer, 'Project(s)');
    const environmentTrigger: Locator = this.assignmentMultiSelectTrigger(drawer, 'Environment(s)');

    await selectComboboxOption(this.page, scopeSelect, 'Environment');
    await selectComboboxOption(this.page, roleSelect, roleName);
    await expect(environmentTrigger).toBeDisabled();
    await selectMultiComboBoxOption(this.page, projectTrigger, projectName);
    await expect(environmentTrigger).toBeEnabled();
    await selectMultiComboBoxOption(this.page, environmentTrigger, `${projectName} / ${environmentName}`);
    await expect(drawer.getByRole('button', { name: 'Add assignment' })).toBeEnabled();
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiMutationResponse(response, compartmentAssignmentsPathname, 'POST'),
      ),
      drawer.getByRole('button', { name: 'Add assignment' }).click(),
    ]);
    await expect(this.assignmentRow(drawer, roleName, `Environment: ${projectName}/${environmentName}`)).toBeVisible();
  }

  private detailDrawer(groupName: string): Locator {
    return accessDetailDrawer(this.page, groupName);
  }

  private async expectEffectivePermissionsCollapsed(drawer: Locator, _permissionKeys: PermissionKey[]): Promise<void> {
    void _permissionKeys;
    await expect(this.effectivePermissionsToggle(drawer)).toHaveAttribute('aria-expanded', 'false');
    await expect(this.effectivePermissionsContent(drawer)).toHaveAttribute('aria-hidden', 'true');
  }

  private async expectEffectivePermissionsExpanded(drawer: Locator, permissionKeys: PermissionKey[]): Promise<void> {
    await expect(this.effectivePermissionsToggle(drawer)).toHaveAttribute('aria-expanded', 'true');
    await expect(this.effectivePermissionsContent(drawer)).toHaveAttribute('aria-hidden', 'false');
    for (const permissionKey of readVisibleEffectivePermissionKeys(permissionKeys)) {
      await expect(this.effectivePermissionKey(drawer, permissionKey)).toBeVisible();
    }
  }

  private effectivePermissionKey(drawer: Locator, permissionKey: PermissionKey): Locator {
    return this.effectivePermissionsContent(drawer).getByText(permissionKey, { exact: true });
  }

  private effectivePermissionsContent(drawer: Locator): Locator {
    return drawer.getByRole('region', { includeHidden: true, name: 'Effective permissions' });
  }

  private effectivePermissionsToggle(drawer: Locator): Locator {
    return drawer.getByRole('button', { name: 'Effective permissions' });
  }

  private assignmentRow(drawer: Locator, roleName: string, scopeLabel: string): Locator {
    return this.assignmentSection(drawer)
      .getByRole('listitem')
      .filter({ hasText: roleName })
      .filter({ hasText: scopeLabel });
  }

  private assignmentSection(drawer: Locator): Locator {
    return drawer.locator('section').filter({ has: this.page.getByRole('heading', { name: 'Assignments' }) });
  }

  private assignmentMultiSelectTrigger(drawer: Locator, label: string): Locator {
    return drawer.getByRole('button', { name: new RegExp(`^${escapeForRegExp(label)}`, 'u') });
  }

  private groupRow(groupName: string): Locator {
    return this.page.getByRole('row').filter({ hasText: groupName });
  }

  private async toggleEffectivePermissions(drawer: Locator): Promise<void> {
    await this.effectivePermissionsToggle(drawer).click();
  }

  private isCreateGroupUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserGroupsPathname) && url.searchParams.get('mode') === 'create';
  }

  private isGroupDetailUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserGroupsPathname) && url.searchParams.has('groupId');
  }

  private isGroupsListResponse(response: Response): boolean {
    return isSuccessfulApiResponse(response, compartmentGroupsPathname) && response.request().method() === 'GET';
  }

  private isGroupMembersResponse(response: Response): boolean {
    const responseUrl: URL = new URL(response.url());
    return (
      response.status() === 200 &&
      responseUrl.pathname.startsWith(`${compartmentGroupsPathname}/`) &&
      responseUrl.pathname.endsWith(compartmentGroupMembersPathnameSuffix)
    );
  }

  private isGroupMembersMutationResponse(response: Response, method: string): boolean {
    return this.isGroupMembersResponse(response) && response.request().method() === method;
  }

  private buildOrganizationPathname(pathname: string): string {
    return buildCompartmentConsoleOrganizationScopedPathname(this.organizationSlug, pathname);
  }
}

async function selectComboboxOption(page: Page, combobox: Locator, optionName: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { exact: true, name: optionName }).click();
}

async function selectMultiComboBoxOption(page: Page, trigger: Locator, optionName: string): Promise<void> {
  await trigger.click();
  await page.getByRole('button', { exact: true, name: optionName }).click();
  await trigger.click();
}

function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

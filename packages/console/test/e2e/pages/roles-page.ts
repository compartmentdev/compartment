import {
  buildCompartmentConsoleOrganizationScopedPathname,
  compartmentBrowserRolesPathname,
  compartmentRolesPathname,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response as PlaywrightResponse } from '@playwright/test';
import { accessDetailDrawer } from '../support/access-drawer';
import { isSuccessfulApiMutationResponse, isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';
import { readVisibleEffectivePermissionKeys } from '../support/effective-permissions';

export class RolesPage {
  private readonly organizationSlug: string;
  private readonly page: Page;
  private readonly searchInput: Locator;

  constructor(page: Page, organizationSlug: string) {
    this.organizationSlug = organizationSlug;
    this.page = page;
    this.searchInput = page.getByRole('searchbox', { name: 'Search roles' });
  }

  async goto(): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentRolesPathname),
      ),
      this.page.waitForURL((url: URL): boolean => isConsolePathname(url, compartmentBrowserRolesPathname)),
      this.page.goto(this.buildOrganizationPathname(compartmentBrowserRolesPathname)),
    ]);
  }

  async expectReady(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Roles' })).toBeVisible();
    await expect(this.searchInput).toBeVisible();
    await expect(this.page.getByRole('table')).toBeVisible();
  }

  async expectRoleVisible(roleName: string): Promise<void> {
    await expect(this.roleRow(roleName)).toBeVisible();
  }

  async createRole(roleName: string, description: string, permissionKeys: PermissionKey[]): Promise<void> {
    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isCreateRoleUrl(url)),
      this.page.getByRole('button', { name: 'Create role' }).click(),
    ]);

    const drawer: Locator = this.detailDrawer('Create role');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Create role', { exact: true })).toBeVisible();
    await drawer.getByLabel('Role name').fill(roleName);
    await drawer.getByLabel('Description').fill(description);
    for (const permissionKey of permissionKeys) {
      await drawer.getByLabel(permissionKey, { exact: true }).check();
      await expect(drawer.getByLabel(permissionKey, { exact: true })).toBeChecked();
    }

    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiMutationResponse(response, compartmentRolesPathname, 'POST'),
      ),
      this.page.waitForURL((url: URL): boolean => this.isRoleListUrl(url)),
      drawer.getByRole('button', { name: 'Create new role' }).click(),
    ]);
    await expect(drawer).toBeHidden();
    await this.expectRoleVisible(roleName);
  }

  async openRoleDetails(roleName: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isRoleDetailUrl(url)),
      this.roleRow(roleName).getByRole('button', { name: 'Manage' }).click(),
    ]);
    await expect(this.detailDrawer(roleName)).toBeVisible();
  }

  async expectRoleDetailsVisible(roleName: string, permissionKeys: PermissionKey[] = []): Promise<void> {
    const drawer: Locator = this.detailDrawer(roleName);

    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(roleName, { exact: true })).toBeVisible();
    await expect(drawer.getByText('selected permissions')).toHaveCount(0);
    await expect(drawer.getByRole('heading', { name: 'Effective permissions' })).toBeVisible();
    await expect(drawer.getByText(/effective permissions in total/u)).toBeVisible();
    await this.expectEffectivePermissionsExpanded(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsCollapsed(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsExpanded(drawer, permissionKeys);
  }

  async closeRoleDetails(roleName: string): Promise<void> {
    const drawer: Locator = this.detailDrawer(roleName);

    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isRoleListUrl(url)),
      drawer.getByRole('button', { name: 'Close panel' }).click(),
    ]);
    await expect(drawer).toBeHidden();
  }

  private detailDrawer(roleName: string): Locator {
    return accessDetailDrawer(this.page, roleName);
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

  private isCreateRoleUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserRolesPathname) && url.searchParams.get('mode') === 'create';
  }

  private isRoleListUrl(url: URL): boolean {
    return (
      isConsolePathname(url, compartmentBrowserRolesPathname) &&
      !url.searchParams.has('mode') &&
      !url.searchParams.has('roleId')
    );
  }

  private isRoleDetailUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserRolesPathname) && url.searchParams.has('roleId');
  }

  private roleRow(roleName: string): Locator {
    return this.page.getByRole('row').filter({ hasText: roleName });
  }

  private async toggleEffectivePermissions(drawer: Locator): Promise<void> {
    await this.effectivePermissionsToggle(drawer).click();
  }

  private buildOrganizationPathname(pathname: string): string {
    return buildCompartmentConsoleOrganizationScopedPathname(this.organizationSlug, pathname);
  }
}

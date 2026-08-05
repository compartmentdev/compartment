import {
  buildCompartmentConsoleOrganizationScopedPathname,
  buildCompartmentUserAccessApiPathname,
  compartmentAssignmentScopeOptionsPathname,
  compartmentBrowserUsersPathname,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
  compartmentBrowserOrganizationsPathname,
  compartmentUsersApiPathname,
  type PermissionKey,
} from '@compartment/contracts/browser';
import {
  compartmentOrganizationsPathname,
  createOrganizationResponseSchema,
  type CreateOrganizationResponse,
} from '@compartment/contracts';
import { expect, type Locator, type Page, type Response as PlaywrightResponse } from '@playwright/test';
import { accessDetailDrawer } from '../support/access-drawer';
import { isSuccessfulApiMutationResponse, isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';
import { readVisibleEffectivePermissionKeys } from '../support/effective-permissions';

interface PasswordResetApiRequestInput {
  csrfCookieName: string;
  csrfHeaderName: string;
  currentOrganizationHeaderName: string;
  organizationsPathname: string;
  path: string;
}

interface CreateOrganizationApiRequestInput {
  csrfCookieName: string;
  csrfHeaderName: string;
  name: string;
  path: string;
  slug: string;
}

interface CreateOrganizationApiResult {
  body: CreateOrganizationResponse;
  status: number;
}

interface PasswordResetApiResult {
  body: PasswordResetErrorBody | null;
  status: number;
}

interface PasswordResetErrorBody {
  error?: PasswordResetErrorDetails | undefined;
}

interface PasswordResetErrorDetails {
  code?: string | undefined;
}

export class UsersPage {
  private readonly inviteUserButton: Locator;
  private readonly organizationSlug: string;
  private readonly page: Page;
  private readonly searchInput: Locator;

  constructor(page: Page, organizationSlug: string) {
    this.inviteUserButton = page.getByRole('button', { name: 'Invite user' });
    this.organizationSlug = organizationSlug;
    this.page = page;
    this.searchInput = page.getByRole('searchbox', { name: 'Search users' });
  }

  async goto(): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentUsersApiPathname),
      ),
      this.page.waitForURL((url: URL): boolean => isConsolePathname(url, compartmentBrowserUsersPathname)),
      this.page.goto(this.buildOrganizationPathname(compartmentBrowserUsersPathname)),
    ]);
  }

  async gotoOrganization(organizationSlug: string): Promise<void> {
    const pathname: string = buildCompartmentConsoleOrganizationScopedPathname(
      organizationSlug,
      compartmentBrowserUsersPathname,
    );
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentUsersApiPathname),
      ),
      this.page.waitForURL((url: URL): boolean => url.pathname === pathname),
      this.page.goto(pathname),
    ]);
  }

  async gotoUserDetails(email: string): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentUsersApiPathname),
      ),
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, buildCompartmentUserAccessApiPathname(email)),
      ),
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentAssignmentScopeOptionsPathname),
      ),
      this.page.waitForURL((url: URL): boolean => this.isUserDetailUrl(url, email)),
      this.page.goto(this.buildUserDetailsHref(email)),
    ]);
  }

  async expectReady(): Promise<void> {
    await expect(
      this.page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Users/ }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(this.page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(this.searchInput).toBeVisible();
    await expect(this.page.getByRole('table')).toBeVisible();
  }

  async expectUserVisible(email: string): Promise<void> {
    await expect(this.userRow(email)).toBeVisible();
  }

  async inviteUser(email: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isCreateUserUrl(url)),
      this.inviteUserButton.click(),
    ]);

    const drawer: Locator = this.inviteDrawer();
    await expect(drawer.getByRole('heading', { name: 'Invite user' })).toBeVisible();
    await drawer.getByLabel('Email').fill(email);
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiMutationResponse(response, compartmentUsersApiPathname, 'POST'),
      ),
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, buildCompartmentUserAccessApiPathname(email)),
      ),
      this.page.waitForURL((url: URL): boolean => this.isUserDetailUrl(url, email)),
      drawer.getByRole('button', { name: 'Invite user' }).click(),
    ]);
    await expect(this.detailDrawer(email)).toBeVisible();
  }

  async inviteUserAndReadActivationToken(email: string): Promise<string> {
    await this.inviteUser(email);

    const activationLinkInput: Locator = this.detailDrawer(email).locator('input[readonly]').first();
    await expect(activationLinkInput).toHaveValue(/\/activate\?/u);

    return this.readActivationToken(await activationLinkInput.inputValue());
  }

  async inviteExistingUserAndExpectNoActivationToken(email: string): Promise<void> {
    await this.inviteUser(email);
    await expect(this.detailDrawer(email).locator('input[readonly]')).toHaveCount(0);
  }

  async createOrganization(name: string, slug: string): Promise<CreateOrganizationResponse> {
    const response: CreateOrganizationApiResult = await this.page.evaluate(
      async (input: CreateOrganizationApiRequestInput): Promise<CreateOrganizationApiResult> => {
        const headers: Headers = new Headers({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        });
        const csrfCookiePattern: RegExp = new RegExp(`(?:^|; )${input.csrfCookieName}=([^;]*)`, 'u');
        const csrfCookieMatch: RegExpMatchArray | null = csrfCookiePattern.exec(document.cookie);
        const csrfToken: string | undefined =
          csrfCookieMatch === null ? undefined : decodeURIComponent(csrfCookieMatch[1]!);
        if (csrfToken !== undefined) {
          headers.set(input.csrfHeaderName, csrfToken);
        }

        const createResponse: Response = await fetch(input.path, {
          body: JSON.stringify({ name: input.name, slug: input.slug }),
          credentials: 'same-origin',
          headers,
          method: 'POST',
        });

        const body: CreateOrganizationResponse = (await createResponse.json()) as CreateOrganizationResponse;
        return { body, status: createResponse.status };
      },
      {
        csrfCookieName: compartmentCsrfCookieName,
        csrfHeaderName: compartmentCsrfHeaderName,
        name,
        path: compartmentOrganizationsPathname,
        slug,
      },
    );

    expect(response.status).toBe(200);
    return createOrganizationResponseSchema.parse(response.body);
  }

  async openUserDetails(email: string): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, buildCompartmentUserAccessApiPathname(email)),
      ),
      this.page.waitForResponse((response: PlaywrightResponse): boolean =>
        isSuccessfulApiResponse(response, compartmentAssignmentScopeOptionsPathname),
      ),
      this.page.waitForURL((url: URL): boolean => this.isUserDetailUrl(url, email)),
      this.userRow(email).getByRole('button', { name: 'Manage' }).click(),
    ]);
  }

  async expectUserDetailsVisible(email: string, groupName: string, permissionKeys: PermissionKey[]): Promise<void> {
    const drawer: Locator = this.detailDrawer(email);

    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(email, { exact: true })).toBeVisible();
    await expect(drawer.getByText('Inherited access')).toHaveCount(0);
    await expect(drawer.getByText('Manual access')).toHaveCount(0);
    await expect(drawer.getByText('Effective total')).toHaveCount(0);
    await expect(drawer.getByText(groupName, { exact: true })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Groups' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Direct assignments' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Effective permissions' })).toBeVisible();
    await expect(drawer.getByText(/effective permissions in total/u)).toBeVisible();
    await this.expectEffectivePermissionsExpanded(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsCollapsed(drawer, permissionKeys);
    await this.toggleEffectivePermissions(drawer);
    await this.expectEffectivePermissionsExpanded(drawer, permissionKeys);
  }

  async expectPasswordResetUnavailable(email: string): Promise<void> {
    const drawer: Locator = this.detailDrawer(email);

    await expect(drawer.getByRole('button', { name: 'Reset password' })).toHaveCount(0);
    const response: PasswordResetApiResult = await this.page.evaluate(
      async (input: PasswordResetApiRequestInput): Promise<PasswordResetApiResult> => {
        const headers: Headers = new Headers({ Accept: 'application/json' });
        const csrfCookiePattern: RegExp = new RegExp(`(?:^|; )${input.csrfCookieName}=([^;]*)`, 'u');
        const csrfCookieMatch: RegExpMatchArray | null = csrfCookiePattern.exec(document.cookie);
        const csrfToken: string | undefined =
          csrfCookieMatch === null ? undefined : decodeURIComponent(csrfCookieMatch[1]!);
        if (csrfToken !== undefined) {
          headers.set(input.csrfHeaderName, csrfToken);
        }
        const organizationPathPrefix: string = `${input.organizationsPathname}/`;
        if (!window.location.pathname.startsWith(organizationPathPrefix)) {
          throw new Error(`Expected organization-scoped users route, got ${window.location.pathname}.`);
        }
        const organizationSlug: string | undefined = window.location.pathname
          .slice(organizationPathPrefix.length)
          .split('/')[0];
        if (organizationSlug === undefined || organizationSlug.length === 0) {
          throw new Error(`Expected organization slug in ${window.location.pathname}.`);
        }
        headers.set(input.currentOrganizationHeaderName, decodeURIComponent(organizationSlug));

        const resetResponse: Response = await fetch(input.path, {
          credentials: 'same-origin',
          headers,
          method: 'POST',
        });
        let body: PasswordResetErrorBody | null = null;
        try {
          body = (await resetResponse.json()) as PasswordResetErrorBody;
        } catch {
          body = null;
        }
        return { body, status: resetResponse.status };
      },
      {
        csrfCookieName: compartmentCsrfCookieName,
        csrfHeaderName: compartmentCsrfHeaderName,
        currentOrganizationHeaderName: compartmentCurrentOrganizationHeaderName,
        organizationsPathname: compartmentBrowserOrganizationsPathname,
        path: this.buildUserPasswordResetApiPathname(email),
      },
    );

    expect(response.status).toBe(409);
    expect(response.body?.error?.code).toBe('password_reset_not_available');
    await expect(drawer.locator('input[value*="reset-password"]')).toHaveCount(0);
  }

  private detailDrawer(email: string): Locator {
    return accessDetailDrawer(this.page, email);
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

  private inviteDrawer(): Locator {
    return accessDetailDrawer(this.page, 'Invite user');
  }

  private async toggleEffectivePermissions(drawer: Locator): Promise<void> {
    await this.effectivePermissionsToggle(drawer).click();
  }

  private isCreateUserUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserUsersPathname) && url.searchParams.get('mode') === 'create';
  }

  private isUserDetailUrl(url: URL, email: string): boolean {
    return isConsolePathname(url, compartmentBrowserUsersPathname) && url.searchParams.get('userEmail') === email;
  }

  private buildUserDetailsHref(email: string): string {
    const searchParams: URLSearchParams = new URLSearchParams({
      q: email,
      userEmail: email,
    });

    return `${this.readCurrentUsersPathname()}?${searchParams.toString()}`;
  }

  private readCurrentUsersPathname(): string {
    const currentUrl: URL = new URL(this.page.url());
    return isConsolePathname(currentUrl, compartmentBrowserUsersPathname)
      ? currentUrl.pathname
      : compartmentBrowserUsersPathname;
  }

  private buildUserPasswordResetApiPathname(email: string): string {
    return `${compartmentUsersApiPathname}/${encodeURIComponent(email)}/password-reset`;
  }

  private readActivationToken(activationUrl: string): string {
    const token: string | null = new URL(activationUrl).searchParams.get('token');
    if (token === null) {
      throw new Error('Expected invitation activation token.');
    }

    return token;
  }

  private userRow(email: string): Locator {
    return this.page.getByRole('row').filter({ hasText: email });
  }

  private buildOrganizationPathname(pathname: string): string {
    return buildCompartmentConsoleOrganizationScopedPathname(this.organizationSlug, pathname);
  }
}

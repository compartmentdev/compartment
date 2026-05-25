import {
  activateResponseSchema,
  compartmentAuthActivatePathname,
  compartmentCurrentOrganizationHeaderName,
  compartmentProjectsApiPathname,
  type ActivateResponse,
  type OrganizationSummary,
} from '@compartment/contracts/browser';
import { expect, type APIRequestContext, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { test, type ConsoleFixtures } from '../fixtures/console-test';
import { LoginPage } from '../pages/login-page';
import { readConsoleE2eAdminAccount, type ConsoleE2eAccount } from '../support/console-e2e-account';
import type { ConsoleE2eAccessFixture } from '../support/console-e2e-fixture';

interface AuthSecurityFixtures extends ConsoleFixtures {
  request: APIRequestContext;
}

interface ProjectsErrorBody {
  error?: ProjectsErrorDetails | undefined;
}

interface ProjectsErrorDetails {
  code?: string | undefined;
}

const targetUserCredential: string = ['console', 'e2e', 'target', 'credential'].join('-');

test.describe('console auth security real app', (): void => {
  test('does not let a second organization take over invite activation or reset an active user', async ({
    e2eAccess,
    page,
    projectsPage,
    request,
    usersPage,
  }: AuthSecurityFixtures & { page: Page }, testInfo: TestInfo): Promise<void> => {
    const targetEmail: string = readAuthSecurityTargetEmail(e2eAccess, testInfo);
    const betaOrganizationSlug: string = readAuthSecurityOrganizationSlug(testInfo);
    const adminAccount: ConsoleE2eAccount = readConsoleE2eAdminAccount();
    const adminLoginPage: LoginPage = new LoginPage(page, adminAccount);

    await projectsPage.goto();
    await adminLoginPage.login(projectsPage.getReadyLocator());
    await projectsPage.expectReady();

    await usersPage.goto();
    await usersPage.expectReady();
    const acmeActivationToken: string = await usersPage.inviteUserAndReadActivationToken(targetEmail);

    await usersPage.createOrganization('Auth Security Beta', betaOrganizationSlug);
    await usersPage.gotoOrganization(betaOrganizationSlug);
    await usersPage.expectReady();
    await usersPage.inviteExistingUserAndExpectNoActivationToken(targetEmail);
    const activatePayload: ActivateResponse = await activateTargetUser(request, targetEmail, acmeActivationToken);
    expect(activatePayload.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual(
      [adminAccount.organizationSlug],
    );
    await expectSessionCannotUseOrganization(
      request,
      requireActivationSessionToken(activatePayload),
      betaOrganizationSlug,
    );

    await usersPage.gotoOrganization(betaOrganizationSlug);
    await usersPage.gotoUserDetails(targetEmail);
    await usersPage.expectReady();
    await usersPage.expectPasswordResetUnavailable(targetEmail);
  });
});

async function activateTargetUser(
  request: APIRequestContext,
  email: string,
  bootstrapToken: string,
): Promise<ActivateResponse> {
  const response: APIResponse = await request.post(compartmentAuthActivatePathname, {
    data: {
      bootstrapToken,
      email,
      password: targetUserCredential,
    },
  });

  expect(response.status()).toBe(200);
  return activateResponseSchema.parse((await response.json()) as ActivateResponse);
}

async function expectSessionCannotUseOrganization(
  request: APIRequestContext,
  sessionToken: string,
  organizationSlug: string,
): Promise<void> {
  const response: APIResponse = await request.get(compartmentProjectsApiPathname, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
  });

  expect(response.status()).toBe(404);
  const body: ProjectsErrorBody = (await response.json()) as ProjectsErrorBody;
  expect(body.error?.code).toBe('organization_not_found');
}

function requireActivationSessionToken(response: ActivateResponse): string {
  if (response.sessionToken === undefined) {
    throw new Error('Expected token activation response.');
  }

  return response.sessionToken;
}

function readAuthSecurityTargetEmail(fixture: ConsoleE2eAccessFixture, testInfo: TestInfo): string {
  return fixture.userEmail.replace('@', `+auth-security-${testInfo.workerIndex}-${Date.now()}@`);
}

function readAuthSecurityOrganizationSlug(testInfo: TestInfo): string {
  return `auth-security-beta-${testInfo.workerIndex}-${Date.now()}`;
}

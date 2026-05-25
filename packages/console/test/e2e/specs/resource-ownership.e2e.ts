import {
  compartmentAuthLoginPathname,
  compartmentCurrentOrganizationHeaderName,
  compartmentDeploymentRunLogsPathname,
  loginResponseSchema,
  type LoginResponse,
} from '@compartment/contracts/browser';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { test, type ConsoleFixtures } from '../fixtures/console-test';
import { readConsoleE2eAccount, type ConsoleE2eAccount } from '../support/console-e2e-account';

interface ResourceOwnershipFixtures extends ConsoleFixtures {
  request: APIRequestContext;
}

interface ApiErrorResponse {
  error: {
    code: string;
  };
}

test.describe('console resource ownership e2e', (): void => {
  test('hides deployment run logs when the run id belongs to another organization', async ({
    e2eDeployment,
    e2eResourceOwnership,
    request,
  }: ResourceOwnershipFixtures): Promise<void> => {
    const sessionToken: string = await loginForSessionToken(request);

    const logsResponse: APIResponse = await request.get(
      buildRunLogsUrl(e2eDeployment.projectName, e2eDeployment.deploymentRunId),
      {
        headers: buildOrganizationHeaders(sessionToken, e2eResourceOwnership.otherOrganizationSlug),
      },
    );

    expect(logsResponse.status()).toBe(404);
    expect(((await logsResponse.json()) as ApiErrorResponse).error.code).toBe('deployment_not_found');
  });
});

async function loginForSessionToken(request: APIRequestContext): Promise<string> {
  const account: ConsoleE2eAccount = readConsoleE2eAccount();
  const response: APIResponse = await request.post(compartmentAuthLoginPathname, {
    data: {
      email: account.email,
      password: account.password,
      sessionDelivery: 'token',
    },
  });

  expect(response.status()).toBe(200);
  const payload: LoginResponse = loginResponseSchema.parse(await response.json());
  if (payload.sessionToken === undefined) {
    throw new Error('Expected token-delivered login response.');
  }

  return payload.sessionToken;
}

function buildRunLogsUrl(projectName: string, deploymentRunId: string): string {
  const searchParams: URLSearchParams = new URLSearchParams({
    deploymentRunId,
    projectName,
    selector: 'run',
  });

  return `${compartmentDeploymentRunLogsPathname}?${searchParams.toString()}`;
}

function buildOrganizationHeaders(sessionToken: string, organizationSlug: string): Record<string, string> {
  return {
    authorization: `Bearer ${sessionToken}`,
    [compartmentCurrentOrganizationHeaderName]: organizationSlug,
  };
}

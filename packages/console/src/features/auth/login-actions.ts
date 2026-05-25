import {
  loginDiscoveryRequestSchema,
  loginResponseSchema,
  loginStateResponseSchema,
  type LoginDiscoveryRequest,
  type LoginRequest,
  type LoginResponse,
  type LoginStateResponse,
} from '@compartment/contracts/browser';
import type { FormEvent } from 'react';
import { browserHomePathname } from '../../browser-public-paths';
import { authApiLoginDiscoveryPathname, authApiLoginPathname } from './auth-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';
import { logoutBrowserSession } from '../../lib/browser-logout';
import { readFormString } from '../../lib/form-data';
import { readAuthFlowTargetFields } from './auth-form.helpers';
import { clearBrowserLoginSuccessRedirect, readLoginSuccessRedirectTo } from './login-success-redirect';

export type LoginErrorHandler = (message: string | undefined) => void;
export type LoginStateHandler = (data: LoginStateResponse) => void;

export async function submitLoginDiscovery(
  event: FormEvent<HTMLFormElement>,
  data: LoginStateResponse,
  onState: LoginStateHandler,
  onError: LoginErrorHandler,
): Promise<void> {
  event.preventDefault();
  const formData: FormData = new FormData(event.currentTarget);
  await submitLoginDiscoveryBody(
    {
      email: readFormString(formData, 'email'),
      ...readAuthFlowTargetFields(data.flowTarget),
    },
    onState,
    onError,
  );
}

export async function submitOrganizationChoice(
  data: LoginStateResponse,
  organizationSlug: string,
  onState: LoginStateHandler,
  onError: LoginErrorHandler,
): Promise<void> {
  await submitLoginDiscoveryBody(
    {
      email: data.email ?? '',
      organizationSlug,
      ...readAuthFlowTargetFields(data.flowTarget),
    },
    onState,
    onError,
  );
}

export async function submitLoginCredentials(
  event: FormEvent<HTMLFormElement>,
  data: LoginStateResponse,
  organizationSlug: string | undefined,
  onError: LoginErrorHandler,
  successRedirectTo?: string,
): Promise<void> {
  event.preventDefault();
  const formData: FormData = new FormData(event.currentTarget);

  try {
    const response: LoginResponse = await requestBrowserApi(authApiLoginPathname, loginResponseSchema, {
      json: readLoginRequestBody(formData, data, organizationSlug),
      method: 'POST',
    });
    redirectAfterLogin(response, successRedirectTo);
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not log in.');
  }
}

export async function submitLogout(onError: LoginErrorHandler): Promise<void> {
  try {
    await logoutBrowserSession();
    window.location.reload();
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not log out.');
  }
}

async function submitLoginDiscoveryBody(
  body: LoginDiscoveryRequest,
  onState: LoginStateHandler,
  onError: LoginErrorHandler,
): Promise<void> {
  try {
    onState(
      await requestBrowserApi(authApiLoginDiscoveryPathname, loginStateResponseSchema, {
        json: loginDiscoveryRequestSchema.parse(body),
        method: 'POST',
      }),
    );
    onError(undefined);
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not continue login.');
  }
}

function readLoginRequestBody(
  formData: FormData,
  data: LoginStateResponse,
  organizationSlug: string | undefined,
): LoginRequest {
  return {
    email: data.email ?? readFormString(formData, 'email'),
    organizationSlug,
    password: readFormString(formData, 'password'),
    sessionDelivery: 'cookie',
    ...readAuthFlowTargetFields(data.flowTarget),
  };
}

function redirectAfterLogin(response: LoginResponse, successRedirectTo: string | undefined): void {
  clearBrowserLoginSuccessRedirect();
  window.location.assign(readLoginSuccessRedirectTo(response.redirectTo ?? browserHomePathname, successRedirectTo));
}

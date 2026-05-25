import { loginStateResponseSchema, type LoginStateResponse } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import {
  browserLoginSuccessRedirectSearchParamName,
  browserOnboardingPathname,
  browserStartOnboardingSearchParamName,
} from '../../browser-public-paths';
import {
  browserSsoFailedLoginErrorCode,
  browserSsoFailedLoginErrorMessage,
} from '../../routes/auth/auth-browser-errors';
import { authApiLoginStatePathname } from './auth-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';
import { buildAuthStatePath } from './auth-state-path';
import { readBrowserLoginSuccessRedirect } from './login-success-redirect';
import { LoginView } from './login-view';

const loginStateSearchParamNames: readonly string[] = ['host', 'path', 'state', 'autoRedirect'];
const loginEmailSearchParamName: string = 'email';

interface LoginPageData {
  errorMessage?: string | undefined;
  initialEmail?: string | undefined;
  state: LoginStateResponse;
  successRedirectTo?: string | undefined;
}

export async function loadLoginPage({ request }: LoaderFunctionArgs): Promise<LoginPageData> {
  const url: URL = new URL(request.url);
  const errorMessage: string | undefined = readLoginPageErrorMessage(url.searchParams.get('error'));
  const loginStatePath: string = buildAuthStatePath(
    authApiLoginStatePathname,
    buildLoginStateSearchParams(url.searchParams, errorMessage),
    loginStateSearchParamNames,
  );

  return {
    errorMessage,
    initialEmail: readLoginEmailHint(url.searchParams),
    state: await requestBrowserApi<LoginStateResponse>(loginStatePath, loginStateResponseSchema),
    successRedirectTo: readLoginSuccessRedirect(url.searchParams),
  };
}

export function LoginPage(): JSX.Element {
  const data: LoginPageData = useLoaderData();

  return (
    <LoginView
      initialData={data.state}
      initialEmail={data.initialEmail}
      initialErrorMessage={data.errorMessage}
      successRedirectTo={data.successRedirectTo}
    />
  );
}

function readLoginPageErrorMessage(value: string | null): string | undefined {
  return value === browserSsoFailedLoginErrorCode ? browserSsoFailedLoginErrorMessage : undefined;
}

function buildLoginStateSearchParams(searchParams: URLSearchParams, errorMessage: string | undefined): URLSearchParams {
  const loginStateSearchParams: URLSearchParams = new URLSearchParams(searchParams);
  if (errorMessage !== undefined) {
    loginStateSearchParams.set('autoRedirect', 'false');
  }

  return loginStateSearchParams;
}

function readLoginEmailHint(searchParams: URLSearchParams): string | undefined {
  const email: string | null = searchParams.get(loginEmailSearchParamName);
  return email === null || email.length === 0 ? undefined : email;
}

function readLoginSuccessRedirect(searchParams: URLSearchParams): string | undefined {
  const successRedirectTo: string | undefined = readBrowserLoginSuccessRedirect(
    searchParams.get(browserLoginSuccessRedirectSearchParamName),
  );
  if (successRedirectTo !== undefined) {
    return successRedirectTo;
  }

  return searchParams.has(browserStartOnboardingSearchParamName) ? browserOnboardingPathname : undefined;
}

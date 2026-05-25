import {
  resetPasswordResponseSchema,
  resetPasswordStateResponseSchema,
  type ResetPasswordResponse,
  type ResetPasswordStateResponse,
} from '@compartment/contracts/browser';
import { useState, type FormEvent, type JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { browserHomePathname } from '../../browser-public-paths';
import { requestBrowserApi } from '../../lib/browser-api';
import { readFormString } from '../../lib/form-data';
import { authApiResetPasswordPathname, authApiResetPasswordStatePathname } from './auth-api-paths';
import { createAuthErrorState, readNextAuthErrorState, type AuthErrorState } from './auth-error-state';
import { readAuthFlowTargetFields } from './auth-form.helpers';
import { AuthPageShell } from './auth-page-shell';
import { authTokenStateSearchParamNames } from './auth-state-search-params';
import { buildAuthStatePath } from './auth-state-path';
import {
  AuthEmailField,
  AuthPasswordFields,
  AuthSubmitButton,
  AuthTokenField,
  readConfirmedPassword,
} from './auth-token-password-form';

interface ResetPasswordFormProps {
  data: ResetPasswordStateResponse;
  onError: ResetPasswordErrorHandler;
}

export async function loadResetPasswordPage({ request }: LoaderFunctionArgs): Promise<ResetPasswordStateResponse> {
  const url: URL = new URL(request.url);

  return await requestBrowserApi<ResetPasswordStateResponse>(
    buildAuthStatePath(authApiResetPasswordStatePathname, url.searchParams, authTokenStateSearchParamNames),
    resetPasswordStateResponseSchema,
  );
}

export function ResetPasswordPage(): JSX.Element {
  const data: ResetPasswordStateResponse = useLoaderData();
  const [errorState, setErrorState] = useState<AuthErrorState>((): AuthErrorState => createAuthErrorState(undefined));

  const handleError: ResetPasswordErrorHandler = (message: string | undefined): void => {
    setErrorState((current: AuthErrorState): AuthErrorState => readNextAuthErrorState(current, message));
  };

  return (
    <AuthPageShell errorMessage={errorState.message} errorMessageId={errorState.id} title="Reset password">
      <ResetPasswordForm data={data} onError={handleError} />
    </AuthPageShell>
  );
}

type ResetPasswordErrorHandler = (message: string | undefined) => void;

function ResetPasswordForm({ data, onError }: Readonly<ResetPasswordFormProps>): JSX.Element {
  return (
    <form
      className="mt-6 grid gap-3"
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        void submitResetPassword(event, data, onError);
      }}
    >
      <AuthEmailField defaultValue={data.email} />
      <AuthTokenField hasToken={data.hasToken} label="Password reset token" name="resetToken" />
      <AuthPasswordFields confirmationLabel="Confirm new password" passwordLabel="New password" />
      <AuthSubmitButton label="Reset password" />
    </form>
  );
}

async function submitResetPassword(
  event: FormEvent<HTMLFormElement>,
  data: ResetPasswordStateResponse,
  onError: ResetPasswordErrorHandler,
): Promise<void> {
  event.preventDefault();
  const formData: FormData = new FormData(event.currentTarget);

  try {
    const password: string = readConfirmedPassword(formData);
    const response: ResetPasswordResponse = await submitResetPasswordRequest(data, formData, password);
    window.location.assign(response.redirectTo ?? browserHomePathname);
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not reset password.');
  }
}

async function submitResetPasswordRequest(
  data: ResetPasswordStateResponse,
  formData: FormData,
  password: string,
): Promise<ResetPasswordResponse> {
  return await requestBrowserApi(authApiResetPasswordPathname, resetPasswordResponseSchema, {
    json: {
      email: readFormString(formData, 'email'),
      password,
      resetToken: data.hasToken ? undefined : readFormString(formData, 'resetToken'),
      sessionDelivery: 'cookie',
      ...readAuthFlowTargetFields(data.flowTarget),
    },
    method: 'POST',
  });
}

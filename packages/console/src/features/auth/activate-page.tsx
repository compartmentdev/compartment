import {
  activateResponseSchema,
  activateStateResponseSchema,
  type ActivateResponse,
  type ActivateStateResponse,
} from '@compartment/contracts/browser';
import { useState, type FormEvent, type JSX } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { browserHomePathname, browserLoginPathname } from '../../browser-public-paths';
import { buttonVariants } from '../../components/ui/button';
import { authApiActivatePathname, authApiActivateStatePathname } from './auth-api-paths';
import { requestBrowserApi } from '../../lib/browser-api';
import { readFormString } from '../../lib/form-data';
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

interface ActivateFormProps {
  data: ActivateStateResponse;
  onError: ActivateErrorHandler;
}

export async function loadActivatePage({ request }: LoaderFunctionArgs): Promise<ActivateStateResponse> {
  const url: URL = new URL(request.url);

  return await requestBrowserApi<ActivateStateResponse>(
    buildAuthStatePath(authApiActivateStatePathname, url.searchParams, authTokenStateSearchParamNames),
    activateStateResponseSchema,
  );
}

export function ActivatePage(): JSX.Element {
  const data: ActivateStateResponse = useLoaderData();
  const [errorState, setErrorState] = useState<AuthErrorState>((): AuthErrorState => createAuthErrorState(undefined));

  const handleError: ActivateErrorHandler = (message: string | undefined): void => {
    setErrorState((current: AuthErrorState): AuthErrorState => readNextAuthErrorState(current, message));
  };

  return (
    <AuthPageShell errorMessage={errorState.message} errorMessageId={errorState.id} title="Activate access">
      <ActivateContent data={data} onError={handleError} />
    </AuthPageShell>
  );
}

type ActivateErrorHandler = (message: string | undefined) => void;

function ActivateContent({ data, onError }: Readonly<ActivateFormProps>): JSX.Element {
  if (data.unavailableReason === 'local_password_disabled') {
    return <ActivateUnavailableState data={data} />;
  }

  return <ActivateForm data={data} onError={onError} />;
}

function ActivateForm({ data, onError }: Readonly<ActivateFormProps>): JSX.Element {
  return (
    <form
      className="mt-6 grid gap-3"
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        void submitActivate(event, data, onError);
      }}
    >
      <AuthEmailField defaultValue={data.email} />
      <AuthTokenField hasToken={data.hasToken} label="Invitation token" name="bootstrapToken" />
      <AuthPasswordFields confirmationLabel="Confirm password" passwordLabel="Password" />
      <AuthSubmitButton label="Activate" />
    </form>
  );
}

function ActivateUnavailableState({ data }: Readonly<{ data: ActivateStateResponse }>): JSX.Element {
  return (
    <div className="mt-6 grid gap-4">
      <p className="text-sm leading-6 text-[var(--auth-secondary-foreground)]">
        This invitation does not allow local password activation. Use SSO to sign in instead.
      </p>
      <a
        className={buttonVariants({ className: 'w-full no-underline', size: 'sm', variant: 'secondary' })}
        href={buildActivateLoginPath(data)}
      >
        Go to login
      </a>
    </div>
  );
}

function buildActivateLoginPath(data: ActivateStateResponse): string {
  const searchParams: URLSearchParams = new URLSearchParams(readAuthFlowTargetFields(data.flowTarget));
  if (data.email !== undefined) {
    searchParams.set('email', data.email);
  }

  return searchParams.size === 0 ? browserLoginPathname : `${browserLoginPathname}?${searchParams.toString()}`;
}

async function submitActivate(
  event: FormEvent<HTMLFormElement>,
  data: ActivateStateResponse,
  onError: ActivateErrorHandler,
): Promise<void> {
  event.preventDefault();
  const formData: FormData = new FormData(event.currentTarget);

  try {
    const password: string = readConfirmedPassword(formData);
    const response: ActivateResponse = await submitActivateRequest(data, formData, password);
    window.location.assign(response.redirectTo ?? browserHomePathname);
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Could not activate access.');
  }
}

async function submitActivateRequest(
  data: ActivateStateResponse,
  formData: FormData,
  password: string,
): Promise<ActivateResponse> {
  return await requestBrowserApi(authApiActivatePathname, activateResponseSchema, {
    json: {
      bootstrapToken: data.hasToken ? undefined : readFormString(formData, 'bootstrapToken'),
      email: readFormString(formData, 'email'),
      password,
      sessionDelivery: 'cookie',
      ...readAuthFlowTargetFields(data.flowTarget),
    },
    method: 'POST',
  });
}

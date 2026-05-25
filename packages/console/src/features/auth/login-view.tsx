import { type LoginStateResponse } from '@compartment/contracts/browser';
import { useEffect, useState, type Dispatch, type FormEvent, type JSX, type SetStateAction } from 'react';
import { Button } from '../../components/ui/button';
import { createAuthErrorState, readNextAuthErrorState, type AuthErrorState } from './auth-error-state';
import { AuthPageShell } from './auth-page-shell';
import {
  submitLoginCredentials,
  submitLoginDiscovery,
  type LoginErrorHandler,
  type LoginStateHandler,
} from './login-actions';
import {
  clearBrowserLoginSuccessRedirect,
  isBrowserSsoLoginUrl,
  readLoginSsoRedirectUrl,
  readLoginSuccessRedirectTo,
  rememberBrowserLoginSuccessRedirect,
} from './login-success-redirect';
import {
  LoginEmailField as AuthLoginEmailField,
  LoginPasswordField,
  LoginReadOnlyEmailField,
} from './login-form-fields';
import { LogoutButton, OrganizationChoiceForms, SsoOptions } from './login-option-groups';

interface LoginViewProps {
  initialData: LoginStateResponse;
  initialEmail?: string | undefined;
  initialErrorMessage?: string | undefined;
  successRedirectTo?: string | undefined;
}

interface LoginStateProps {
  data: LoginStateResponse;
  emailHint?: string | undefined;
  onError: LoginErrorHandler;
  onState: LoginStateHandler;
  successRedirectTo?: string | undefined;
}

interface LoginCredentialsFormProps extends LoginStateProps {
  organizationSlug?: string | undefined;
}

interface LoginEmailFieldProps {
  data: LoginStateResponse;
  emailHint?: string | undefined;
}

interface LoginEmailFieldInputProps {
  emailHint?: string | undefined;
}

interface LoginViewShellProps {
  data: LoginStateResponse;
  emailHint?: string | undefined;
  errorState: AuthErrorState;
  handleError: LoginErrorHandler;
  setData: Dispatch<SetStateAction<LoginStateResponse>>;
  successRedirectTo?: string | undefined;
}

export function LoginView(props: Readonly<LoginViewProps>): JSX.Element {
  const { data, errorState, handleError, setData } = useLoginViewState(
    props.initialData,
    props.initialErrorMessage,
    props.successRedirectTo,
  );

  return (
    <LoginViewShell
      data={data}
      emailHint={props.initialEmail}
      errorState={errorState}
      handleError={handleError}
      setData={setData}
      successRedirectTo={props.successRedirectTo}
    />
  );
}

function LoginViewShell(props: Readonly<LoginViewShellProps>): JSX.Element {
  return (
    <AuthPageShell
      brandJustify="start"
      description="Access to hosted apps is managed by the Compartment."
      errorMessage={props.errorState.message}
      errorMessageId={props.errorState.id}
      titleBlockClassName="mt-8 grid gap-2"
      title="Login"
    >
      <LoginContent
        data={props.data}
        emailHint={props.emailHint}
        onError={props.handleError}
        onState={props.setData}
        successRedirectTo={props.successRedirectTo}
      />
    </AuthPageShell>
  );
}

function useLoginViewState(
  initialData: LoginStateResponse,
  initialErrorMessage: string | undefined,
  successRedirectTo: string | undefined,
): {
  data: LoginStateResponse;
  errorState: AuthErrorState;
  handleError: LoginErrorHandler;
  setData: Dispatch<SetStateAction<LoginStateResponse>>;
} {
  const [data, setData] = useState<LoginStateResponse>(initialData);
  const [errorState, setErrorState] = useState<AuthErrorState>(
    (): AuthErrorState => createAuthErrorState(initialErrorMessage),
  );

  useSyncLoginViewState(initialData, initialErrorMessage, setData, setErrorState);
  useSyncLoginRedirect(data.redirectTo, successRedirectTo);
  const handleError: LoginErrorHandler = createLoginErrorHandler(setErrorState);

  return { data, errorState, handleError, setData };
}

function createLoginErrorHandler(setErrorState: Dispatch<SetStateAction<AuthErrorState>>): LoginErrorHandler {
  return (message: string | undefined): void => {
    setErrorState((current: AuthErrorState): AuthErrorState => readNextAuthErrorState(current, message));
  };
}

function useSyncLoginViewState(
  initialData: LoginStateResponse,
  initialErrorMessage: string | undefined,
  setData: Dispatch<SetStateAction<LoginStateResponse>>,
  setErrorState: Dispatch<SetStateAction<AuthErrorState>>,
): void {
  useEffect((): void => {
    setData(initialData);
    setErrorState((current: AuthErrorState): AuthErrorState => readNextAuthErrorState(current, initialErrorMessage));
  }, [initialData, initialErrorMessage, setData, setErrorState]);
}

function useSyncLoginRedirect(redirectTo: string | undefined, successRedirectTo: string | undefined): void {
  useEffect((): void => {
    if (redirectTo !== undefined) {
      if (isBrowserSsoLoginUrl(redirectTo)) {
        rememberBrowserLoginSuccessRedirect(successRedirectTo);
        window.location.assign(readLoginSsoRedirectUrl(redirectTo, successRedirectTo));
        return;
      }

      clearBrowserLoginSuccessRedirect();
      window.location.assign(readLoginSuccessRedirectTo(redirectTo, successRedirectTo));
    }
  }, [redirectTo, successRedirectTo]);
}

function LoginContent(props: Readonly<LoginStateProps>): JSX.Element | null {
  switch (props.data.view) {
    case 'email_entry':
      return <LoginDiscoveryForm {...props} />;
    case 'organization_selection':
      return <LoginOrganizationSelection {...props} />;
    case 'methods':
      return <LoginMethods {...props} />;
    case 'redirect':
      return null;
  }
}

function LoginOrganizationSelection(props: Readonly<LoginStateProps>): JSX.Element {
  return (
    <>
      <OrganizationChoiceForms {...props} />
      <LogoutButton {...props} />
    </>
  );
}

function LoginMethods(props: Readonly<LoginStateProps>): JSX.Element {
  return (
    <>
      <SsoOptions data={props.data} successRedirectTo={props.successRedirectTo} />
      {props.data.localPasswordEnabled === true ? (
        <LoginCredentialsForm {...props} organizationSlug={props.data.organizationSlug} />
      ) : null}
      <LogoutButton {...props} />
    </>
  );
}

function LoginDiscoveryForm({ data, emailHint, onError, onState }: Readonly<LoginStateProps>): JSX.Element {
  return (
    <>
      <form
        className="mt-7 grid"
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          void submitLoginDiscovery(event, data, onState, onError);
        }}
      >
        <div className="grid gap-3">
          <AuthLoginEmailField compact defaultValue={data.email ?? emailHint} name="email" required />
        </div>
        <Button className="mt-7 w-full" type="submit">
          Continue
        </Button>
      </form>
      <LogoutButton data={data} onError={onError} onState={onState} />
    </>
  );
}

function LoginCredentialsForm({
  data,
  emailHint,
  onError,
  organizationSlug,
  successRedirectTo,
}: Readonly<LoginCredentialsFormProps>): JSX.Element {
  return (
    <form
      className="mt-7 grid"
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        void submitLoginCredentials(event, data, organizationSlug, onError, successRedirectTo);
      }}
    >
      <div className="grid gap-3">
        <LoginEmailField data={data} emailHint={emailHint} />
        <LoginPasswordField compact />
      </div>
      <Button className="mt-7 w-full" type="submit">
        Login
      </Button>
    </form>
  );
}

function LoginEmailField({ data, emailHint }: Readonly<LoginEmailFieldProps>): JSX.Element {
  if (data.email !== undefined) {
    return <LoginReadOnlyEmailField compact email={data.email} />;
  }

  return <LoginEmailFieldInput emailHint={emailHint} />;
}

function LoginEmailFieldInput({ emailHint }: Readonly<LoginEmailFieldInputProps>): JSX.Element {
  return <AuthLoginEmailField compact defaultValue={emailHint} name="email" required />;
}

import {
  type LoginOrganizationChoice,
  type LoginSsoProviderOption,
  type LoginStateResponse,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { buttonVariants } from '../../components/ui/button';
import { authTertiaryActionClassName } from './auth-theme';
import { readLoginSsoRedirectUrl, rememberBrowserLoginSuccessRedirect } from './login-success-redirect';
import {
  submitLogout,
  submitOrganizationChoice,
  type LoginErrorHandler,
  type LoginStateHandler,
} from './login-actions';

interface LoginStateProps {
  data: LoginStateResponse;
  onError: LoginErrorHandler;
  onState: LoginStateHandler;
  successRedirectTo?: string | undefined;
}

interface SsoOptionsProps {
  data: LoginStateResponse;
  successRedirectTo?: string | undefined;
}

interface SsoOptionLinkProps {
  option: LoginSsoProviderOption;
  successRedirectTo?: string | undefined;
}

export function OrganizationChoiceForms({ data, onError, onState }: Readonly<LoginStateProps>): JSX.Element | null {
  if ((data.organizationChoices?.length ?? 0) === 0 || data.email === undefined) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-2">
      {data.organizationChoices?.map(
        (choice: LoginOrganizationChoice): JSX.Element => (
          <OrganizationChoiceButton choice={choice} data={data} onError={onError} onState={onState} key={choice.slug} />
        ),
      )}
    </div>
  );
}

export function SsoOptions({ data, successRedirectTo }: Readonly<SsoOptionsProps>): JSX.Element | null {
  if ((data.ssoOptions?.length ?? 0) === 0) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-2">
      {data.ssoOptions?.map(
        (option: LoginSsoProviderOption): JSX.Element => (
          <SsoOptionLink key={option.loginUrl} option={option} successRedirectTo={successRedirectTo} />
        ),
      )}
    </div>
  );
}

function SsoOptionLink({ option, successRedirectTo }: Readonly<SsoOptionLinkProps>): JSX.Element {
  return (
    <a
      className={buttonVariants({
        className: 'w-full justify-center no-underline',
        size: 'sm',
        variant: 'secondary',
      })}
      href={readLoginSsoRedirectUrl(option.loginUrl, successRedirectTo)}
      onClick={(): void => {
        rememberBrowserLoginSuccessRedirect(successRedirectTo);
      }}
    >
      {option.buttonText}
    </a>
  );
}

export function LogoutButton({ data, onError }: Readonly<LoginStateProps>): JSX.Element | null {
  if (data.principalEmail === undefined) {
    return null;
  }

  return (
    <button
      className={authTertiaryActionClassName}
      onClick={(): void => {
        void submitLogout(onError);
      }}
      type="button"
    >
      Log out current compartment session
    </button>
  );
}

function OrganizationChoiceButton({
  choice,
  data,
  onError,
  onState,
}: Readonly<{ choice: LoginOrganizationChoice } & LoginStateProps>): JSX.Element {
  return (
    <button
      className={buttonVariants({
        className: 'w-full justify-start',
        size: 'sm',
        variant: 'secondary',
      })}
      onClick={(): void => {
        void submitOrganizationChoice(data, choice.slug, onState, onError);
      }}
      type="button"
    >
      {choice.name}
    </button>
  );
}

import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { readFormString } from '../../lib/form-data';
import { authFieldLabelClassName, authInputClassName } from './auth-theme';

interface AuthEmailFieldProps {
  defaultValue?: string | undefined;
}

interface AuthPasswordFieldsProps {
  confirmationLabel: string;
  passwordLabel: string;
}

interface AuthSubmitButtonProps {
  label: string;
}

interface AuthTokenFieldProps {
  hasToken: boolean;
  label: string;
  name: string;
}

export function AuthEmailField({ defaultValue }: Readonly<AuthEmailFieldProps>): JSX.Element {
  return (
    <label className="grid gap-1.5">
      <span className={authFieldLabelClassName}>Email</span>
      <Input
        autoComplete="email"
        className={authInputClassName}
        defaultValue={defaultValue}
        name="email"
        required
        type="email"
      />
    </label>
  );
}

export function AuthTokenField({ hasToken, label, name }: Readonly<AuthTokenFieldProps>): JSX.Element | null {
  if (hasToken) {
    return null;
  }

  return (
    <label className="grid gap-1.5">
      <span className={authFieldLabelClassName}>{label}</span>
      <Input autoComplete="off" className={authInputClassName} name={name} required type="text" />
    </label>
  );
}

export function AuthPasswordFields({
  confirmationLabel,
  passwordLabel,
}: Readonly<AuthPasswordFieldsProps>): JSX.Element {
  return (
    <>
      <AuthPasswordField label={passwordLabel} name="password" />
      <AuthPasswordField label={confirmationLabel} name="passwordConfirmation" />
    </>
  );
}

function AuthPasswordField({ label, name }: Readonly<{ label: string; name: string }>): JSX.Element {
  return (
    <label className="grid gap-1.5">
      <span className={authFieldLabelClassName}>{label}</span>
      <Input
        autoComplete="new-password"
        className={authInputClassName}
        minLength={8}
        name={name}
        required
        type="password"
      />
    </label>
  );
}

export function AuthSubmitButton({ label }: Readonly<AuthSubmitButtonProps>): JSX.Element {
  return (
    <Button className="mt-1" type="submit">
      {label}
    </Button>
  );
}

export function readConfirmedPassword(formData: FormData): string {
  const password: string = readFormString(formData, 'password');
  if (password !== readFormString(formData, 'passwordConfirmation')) {
    throw new Error('Password confirmation does not match.');
  }

  return password;
}

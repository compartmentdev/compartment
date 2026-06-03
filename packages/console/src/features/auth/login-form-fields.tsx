import type { InputHTMLAttributes, JSX } from 'react';
import { browserResetPasswordPathname } from '../../browser-public-paths';
import { Input } from '../../components/ui/input';
import { LockKeyhole, Mail } from '../../components/ui/icons';
import { authFieldLabelClassName, authHintLinkClassName, authInputClassName } from './auth-theme';

interface LoginInputFieldProps extends Readonly<Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>> {
  compact?: boolean | undefined;
  hintHref?: string | undefined;
  hintLabel?: string | undefined;
  icon: 'email' | 'password';
  label: string;
}

export function LoginEmailField({
  compact,
  defaultValue,
  name,
  required,
}: Readonly<{
  compact?: boolean | undefined;
  defaultValue?: string | undefined;
  name: string;
  required?: boolean | undefined;
}>): JSX.Element {
  return (
    <LoginInputField
      autoComplete="email"
      compact={compact}
      defaultValue={defaultValue}
      icon="email"
      label="Email"
      name={name}
      placeholder="Email address"
      required={required}
      type="email"
    />
  );
}

export function LoginPasswordField({ compact }: Readonly<{ compact?: boolean | undefined }>): JSX.Element {
  return (
    <LoginInputField
      autoComplete="current-password"
      compact={compact}
      hintHref={compact === true ? undefined : browserResetPasswordPathname}
      hintLabel={compact === true ? undefined : 'Forgot your password?'}
      icon="password"
      label="Password"
      minLength={8}
      name="password"
      placeholder="Password"
      required
      type="password"
    />
  );
}

export function LoginReadOnlyEmailField({
  compact,
  email,
}: Readonly<{ compact?: boolean | undefined; email: string }>): JSX.Element {
  if (compact === true) {
    return (
      <div className={authInputClassName}>
        <span className="block truncate">{email}</span>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <span className={authFieldLabelClassName}>Email</span>
      <div className={authInputClassName}>
        <span className="absolute inset-y-0 left-3 inline-flex items-center text-[var(--auth-icon-default)]">
          <Mail className="size-4" strokeWidth={1.8} />
        </span>
        <span className="block truncate pl-7">{email}</span>
      </div>
    </div>
  );
}

function LoginInputField({
  compact,
  hintHref,
  hintLabel,
  icon,
  label,
  ...inputProps
}: Readonly<LoginInputFieldProps>): JSX.Element {
  if (compact === true) {
    return <CompactLoginInputField inputProps={inputProps} />;
  }

  return (
    <label className="grid gap-1.5">
      <LoginInputFieldHeader hintHref={hintHref} hintLabel={hintLabel} label={label} />
      <div className={authInputClassName}>
        <LoginInputFieldLeadingIcon icon={icon} />
        <Input
          className="border-0 bg-transparent px-0 py-0 pl-7 pr-7 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          {...inputProps}
        />
      </div>
    </label>
  );
}

function CompactLoginInputField({
  inputProps,
}: Readonly<{ inputProps: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> }>): JSX.Element {
  return (
    <div className={authInputClassName}>
      <Input className={compactInputClassName} {...inputProps} />
    </div>
  );
}

function LoginInputFieldHeader({
  hintHref,
  hintLabel,
  label,
}: Readonly<{ hintHref?: string | undefined; hintLabel?: string | undefined; label: string }>): JSX.Element {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className={authFieldLabelClassName}>{label}</span>
      {hintHref !== undefined && hintLabel !== undefined ? (
        <a className={authHintLinkClassName} href={hintHref}>
          {hintLabel}
        </a>
      ) : null}
    </span>
  );
}

function LoginInputFieldLeadingIcon({ icon }: Readonly<{ icon: 'email' | 'password' }>): JSX.Element {
  return (
    <span className="absolute inset-y-0 left-3 inline-flex items-center text-[var(--auth-icon-default)]">
      {icon === 'email' ? (
        <Mail className="size-4" strokeWidth={1.8} />
      ) : (
        <LockKeyhole className="size-4" strokeWidth={1.8} />
      )}
    </span>
  );
}

const compactInputClassName: string =
  'border-0 bg-transparent px-0 py-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0';

import type { InputHTMLAttributes } from 'react';

export type LoginInputAttributes = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

export interface CompactLoginInputFieldProps {
  inputProps: LoginInputAttributes;
}

export interface LoginEmailFieldProps {
  compact?: boolean | undefined;
  defaultValue?: string | undefined;
  name: string;
  required?: boolean | undefined;
}

export interface LoginInputFieldHeaderProps {
  hintHref?: string | undefined;
  hintLabel?: string | undefined;
  label: string;
}

export interface LoginInputFieldLeadingIconProps {
  icon: 'email' | 'password';
}

export interface LoginInputFieldProps extends Readonly<LoginInputAttributes> {
  compact?: boolean | undefined;
  hintHref?: string | undefined;
  hintLabel?: string | undefined;
  icon: 'email' | 'password';
  label: string;
}

export interface LoginPasswordFieldProps {
  compact?: boolean | undefined;
}

export interface LoginReadOnlyEmailFieldProps {
  compact?: boolean | undefined;
  email: string;
}

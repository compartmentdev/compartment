import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';
import { singleLineFieldControlClassName } from './field-styles';

type InputProps = Readonly<InputHTMLAttributes<HTMLInputElement>>;

export function Input({ className, type = 'text', ...props }: InputProps): JSX.Element {
  return <input className={cn(singleLineFieldControlClassName, className)} type={type} {...props} />;
}

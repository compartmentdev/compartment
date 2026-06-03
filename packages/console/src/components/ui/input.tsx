import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';
import { readSingleLineFieldControlClassName, type SingleLineFieldControlSize } from './field-styles';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: SingleLineFieldControlSize | undefined;
}

export function Input({ className, size = 'sm', type = 'text', ...props }: Readonly<InputProps>): JSX.Element {
  return <input className={cn(readSingleLineFieldControlClassName(size), className)} type={type} {...props} />;
}

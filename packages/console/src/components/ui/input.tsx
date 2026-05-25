import type { InputHTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';

type InputProps = Readonly<InputHTMLAttributes<HTMLInputElement>>;

export function Input({ className, type = 'text', ...props }: InputProps): JSX.Element {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      type={type}
      {...props}
    />
  );
}

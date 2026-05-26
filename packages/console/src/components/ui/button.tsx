import type { ButtonHTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant =
  | 'accent'
  | 'default'
  | 'destructive'
  | 'ghost'
  | 'outline'
  | 'secondary'
  | 'soft'
  | 'success';
type ButtonSize = 'default' | 'lg' | 'sm' | 'xs';

interface ButtonVariantInput {
  className?: string | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantInput {}

export function Button({ className, size, variant, ...props }: Readonly<ButtonProps>): JSX.Element {
  return <button className={buttonVariants({ className, size, variant })} {...props} />;
}

export function buttonVariants({
  className,
  size = 'default',
  variant = 'default',
}: Readonly<ButtonVariantInput>): string {
  return cn(readBaseButtonClassName(), readButtonSizeClassName(size), readButtonVariantClassName(variant), className);
}

function readBaseButtonClassName(): string {
  return 'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:cursor-default disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
}

function readButtonSizeClassName(size: ButtonSize): string {
  switch (size) {
    case 'default':
      return 'h-9 px-3.5 py-2';
    case 'lg':
      return 'h-10 px-4.5 py-2';
    case 'sm':
      return 'h-8 px-2.5 text-[12px]';
    case 'xs':
      return 'h-6 gap-1.5 px-2 text-[12px]';
  }
}

function readButtonVariantClassName(variant: ButtonVariant): string {
  switch (variant) {
    case 'accent':
      return 'button-accent-surface';
    case 'default':
      return 'bg-primary text-primary-foreground hover:bg-primary/92';
    case 'destructive':
      return 'button-destructive-surface';
    case 'ghost':
      return 'text-foreground hover:bg-accent hover:text-accent-foreground';
    case 'outline':
      return 'border border-border bg-background text-foreground hover:bg-muted hover:opacity-90 active:bg-muted focus-visible:border-ring';
    case 'secondary':
    case 'soft':
      return 'button-soft-surface';
    case 'success':
      return 'button-success-surface';
  }
}

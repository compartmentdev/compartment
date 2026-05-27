import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentProps, HTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button';

type AlertDialogCancelProps = ComponentProps<typeof AlertDialogPrimitive.Cancel>;
type AlertDialogContentProps = ComponentProps<typeof AlertDialogPrimitive.Content>;
type AlertDialogDescriptionProps = ComponentProps<typeof AlertDialogPrimitive.Description>;
type AlertDialogOverlayProps = ComponentProps<typeof AlertDialogPrimitive.Overlay>;
type AlertDialogTitleProps = ComponentProps<typeof AlertDialogPrimitive.Title>;

type AlertDialogFooterProps = HTMLAttributes<HTMLDivElement>;
type AlertDialogHeaderProps = HTMLAttributes<HTMLDivElement>;

export const AlertDialog: typeof AlertDialogPrimitive.Root = AlertDialogPrimitive.Root;

function AlertDialogOverlay({ className, ...props }: Readonly<AlertDialogOverlayProps>): JSX.Element {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-[rgba(18,20,23,0.44)] backdrop-blur-[4px]', className)}
      {...props}
    />
  );
}

export function AlertDialogContent({ className, ...props }: Readonly<AlertDialogContentProps>): JSX.Element {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[18px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_24px_64px_rgba(15,23,42,0.24)] outline-none',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: Readonly<AlertDialogHeaderProps>): JSX.Element {
  return <div className={cn('grid gap-2 text-left', className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: Readonly<AlertDialogFooterProps>): JSX.Element {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: Readonly<AlertDialogTitleProps>): JSX.Element {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-[18px] font-semibold leading-6 tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({ className, ...props }: Readonly<AlertDialogDescriptionProps>): JSX.Element {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-[13px] leading-5 text-muted-foreground', className)}
      {...props}
    />
  );
}

export function StyledAlertDialogCancel({ className, ...props }: Readonly<AlertDialogCancelProps>): JSX.Element {
  return <AlertDialogPrimitive.Cancel className={buttonVariants({ className, variant: 'soft' })} {...props} />;
}

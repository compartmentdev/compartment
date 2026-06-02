import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, JSX } from 'react';
import { cn } from '../../lib/utils';

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuPrimitive.Content>;
type DropdownMenuItemPrimitiveProps = ComponentProps<typeof DropdownMenuPrimitive.Item>;
type DropdownMenuTriggerProps = ComponentProps<typeof DropdownMenuPrimitive.Trigger>;

type DropdownMenuItemVariant = 'default' | 'destructive';

interface DropdownMenuItemProps extends DropdownMenuItemPrimitiveProps {
  variant?: DropdownMenuItemVariant;
}

export const DropdownMenu: typeof DropdownMenuPrimitive.Root = DropdownMenuPrimitive.Root;

export function DropdownMenuTrigger(props: Readonly<DropdownMenuTriggerProps>): JSX.Element {
  return <DropdownMenuPrimitive.Trigger {...props} />;
}

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: Readonly<DropdownMenuContentProps>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          'z-50 min-w-[180px] rounded-field border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none',
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: Readonly<DropdownMenuItemProps>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex w-full cursor-pointer select-none items-center justify-start text-left font-normal outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        readDropdownMenuItemVariantClassName(variant),
        className,
      )}
      {...props}
    />
  );
}

function readDropdownMenuItemVariantClassName(variant: DropdownMenuItemVariant): string {
  switch (variant) {
    case 'destructive':
      return "rounded-control px-1.5 py-1 text-[13px] leading-5 text-destructive hover:bg-[var(--opacity-destructive-lighter)] hover:text-destructive focus:bg-[var(--opacity-destructive-lighter)] focus:text-destructive data-[highlighted]:bg-[var(--opacity-destructive-lighter)] data-[highlighted]:text-destructive [font-variation-settings:'opsz'_14]";
    case 'default':
      return 'rounded-micro px-2 py-1.5 text-[12px] focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
  }
}

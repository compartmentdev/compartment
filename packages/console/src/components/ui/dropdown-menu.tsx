import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, JSX } from 'react';
import { cn } from '../../lib/utils';

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuPrimitive.Content>;
type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuPrimitive.Item>;
type DropdownMenuTriggerProps = ComponentProps<typeof DropdownMenuPrimitive.Trigger>;

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
          'z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none',
          className,
        )}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: Readonly<DropdownMenuItemProps>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex w-full cursor-pointer select-none items-center justify-start rounded-sm px-2 py-1.5 text-left text-[12px] outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

import { cn } from '../../lib/utils';

export function readProjectNavigationTabClassName(active: boolean): string {
  return cn(
    'relative inline-flex h-8 items-center px-0.5 text-[13px] font-medium leading-5 no-underline transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:origin-center after:rounded-full after:bg-slate-500 after:transition-opacity after:duration-150 after:ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2',
    active ? 'text-foreground after:opacity-100' : 'text-muted-foreground after:opacity-0 hover:text-foreground',
  );
}

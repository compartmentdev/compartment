import { cn } from '../../lib/utils';

const fieldFocusRingClassName: string =
  'focus-visible:ring-[3px] focus-visible:ring-[rgb(163_163_163_/_24%)] focus-visible:ring-offset-0';
const fieldInvalidRingClassName: string =
  'aria-invalid:ring-[3px] aria-invalid:ring-[rgb(164_46_28_/_20%)] dark:aria-invalid:ring-[rgb(215_91_66_/_40%)]';

const fieldOpenRingClassName: string = 'data-[state=open]:ring-[3px] data-[state=open]:ring-[rgb(163_163_163_/_24%)]';

const fieldControlBaseClassName: string =
  'field-control-surface w-full rounded-field border bg-background text-[13px] font-normal leading-5 text-foreground outline-none transition placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50';

export type SingleLineFieldControlSize = 'default' | 'lg' | 'md' | 'sm';

const fieldControlClassName: string = cn(fieldControlBaseClassName, fieldFocusRingClassName, fieldInvalidRingClassName);

export function readSingleLineFieldControlClassName(size: SingleLineFieldControlSize = 'sm'): string {
  return cn(readSingleLineFieldControlSizeClassName(size), fieldControlClassName);
}

function readSingleLineFieldControlSizeClassName(size: SingleLineFieldControlSize = 'sm'): string {
  switch (size) {
    case 'default':
    case 'md':
    case 'lg':
    case 'sm':
      return 'flex h-8 px-2 py-1 text-[12px]';
  }
}

export function readSelectTriggerFieldControlClassName(size: SingleLineFieldControlSize = 'sm'): string {
  return cn(readSelectTriggerFieldControlSizeClassName(size), fieldControlClassName, fieldOpenRingClassName);
}

function readSelectTriggerFieldControlSizeClassName(size: SingleLineFieldControlSize = 'sm'): string {
  switch (size) {
    case 'default':
    case 'md':
    case 'lg':
    case 'sm':
      return 'flex h-8 items-center justify-between gap-2 px-2 py-1 text-left text-[12px] data-[placeholder]:text-muted-foreground';
  }
}

export const selectTriggerFieldControlClassName: string = readSelectTriggerFieldControlClassName();

export const textareaFieldControlClassName: string = cn('min-h-[68px] px-2.5 py-1', fieldControlClassName);

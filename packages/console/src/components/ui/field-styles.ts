import { cn } from '../../lib/utils';

const fieldFocusRingClassName: string =
  'focus-visible:ring-[3px] focus-visible:ring-[rgb(163_163_163_/_24%)] focus-visible:ring-offset-0';
export const fieldFocusWithinRingClassName: string =
  'focus-within:ring-[3px] focus-within:ring-[rgb(163_163_163_/_24%)] focus-within:ring-offset-0';
const fieldInvalidRingClassName: string =
  'aria-invalid:ring-[3px] aria-invalid:ring-[rgb(164_46_28_/_20%)] dark:aria-invalid:ring-[rgb(215_91_66_/_40%)]';

const fieldOpenRingClassName: string = 'data-[state=open]:ring-[3px] data-[state=open]:ring-[rgb(163_163_163_/_24%)]';

export const fieldControlBaseClassName: string =
  'field-control-surface w-full rounded-[10px] border bg-background text-[13px] font-normal leading-5 text-foreground outline-none transition placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50';

const fieldControlClassName: string = cn(fieldControlBaseClassName, fieldFocusRingClassName, fieldInvalidRingClassName);

export const singleLineFieldControlClassName: string = cn('flex h-9 px-2.5 py-1', fieldControlClassName);

export const selectTriggerFieldControlClassName: string = cn(
  'flex h-9 items-center justify-between gap-2 px-2.5 py-1 text-left data-[placeholder]:text-muted-foreground',
  fieldControlClassName,
  fieldOpenRingClassName,
);

export const textareaFieldControlClassName: string = cn('min-h-[68px] px-2.5 py-1', fieldControlClassName);

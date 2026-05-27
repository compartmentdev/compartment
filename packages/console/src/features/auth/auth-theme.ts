import { fieldControlBaseClassName, fieldFocusWithinRingClassName } from '../../components/ui/field-styles';
import { cn } from '../../lib/utils';

export const authFieldLabelClassName: string = 'text-[12px] font-medium text-[var(--auth-secondary-foreground)]';

export const authInputClassName: string = cn(
  'relative flex h-9 items-center px-2.5 py-1',
  fieldControlBaseClassName,
  fieldFocusWithinRingClassName,
);

export const authTertiaryActionClassName: string =
  'mt-4 cursor-pointer text-[12px] text-[var(--auth-muted-foreground)] underline underline-offset-4 transition-colors hover:text-[var(--auth-secondary-foreground)]';

export const authHintLinkClassName: string =
  'text-[14px] leading-5 text-[var(--auth-link-color)] no-underline transition-colors hover:text-[var(--auth-link-hover-color)]';

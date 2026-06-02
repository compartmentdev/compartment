import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils';
import { Input } from './ui/input';
import { Search, X } from './ui/icons';

interface ServerSearchProps {
  children?: ReactNode | undefined;
  className?: string | undefined;
  hasLeadingSearchIcon?: boolean | undefined;
  label: string;
  onSearch: ServerSearchSubmitHandler;
  placeholder: string;
  value: string;
}

type ServerSearchSubmitHandler = (searchQuery: string) => void;
type ServerSearchValueChangeHandler = (searchQuery: string) => void;

interface ServerSearchTimeoutRef {
  current: number | undefined;
}

type ServerSearchFormSubmitHandler = (event: FormEvent<HTMLFormElement>) => void;
type ServerSearchClearHandler = (event: MouseEvent<HTMLButtonElement>) => void;

interface ServerSearchFormProps extends ServerSearchProps {
  inputValue: string;
  onInputValueChange: ServerSearchValueChangeHandler;
  timeoutRef: ServerSearchTimeoutRef;
}

interface ServerSearchInputProps {
  hasLeadingSearchIcon: boolean;
  inputValue: string;
  label: string;
  onInputValueChange: ServerSearchValueChangeHandler;
  onSearch: ServerSearchSubmitHandler;
  placeholder: string;
  timeoutRef: ServerSearchTimeoutRef;
}

interface ServerSearchClearButtonProps {
  onClear: ServerSearchClearHandler;
  visible: boolean;
}

interface ServerSearchLeadingIconProps {
  visible: boolean;
}

interface ServerSearchTextInputProps {
  hasLeadingSearchIcon: boolean;
  inputValue: string;
  onInputValueChange: ServerSearchValueChangeHandler;
  onSearch: ServerSearchSubmitHandler;
  placeholder: string;
  timeoutRef: ServerSearchTimeoutRef;
}

const serverSearchDebounceMs: number = 300;

export function ServerSearch(props: Readonly<ServerSearchProps>): JSX.Element {
  const timeoutRef: ServerSearchTimeoutRef = useRef<number | undefined>(undefined);
  const [inputValue, setInputValue] = useState<string>(props.value);

  useEffect((): (() => void) => {
    return (): void => {
      clearServerSearchTimeout(timeoutRef);
    };
  }, []);

  return (
    <ServerSearchForm {...props} inputValue={inputValue} onInputValueChange={setInputValue} timeoutRef={timeoutRef} />
  );
}

function ServerSearchForm(props: Readonly<ServerSearchFormProps>): JSX.Element {
  const onSubmit: ServerSearchFormSubmitHandler = createServerSearchSubmitHandler(props.onSearch, props.timeoutRef);

  return (
    <form className={cn('w-full max-w-md', props.className)} onSubmit={onSubmit} role="search">
      {props.children}
      <ServerSearchInput {...props} hasLeadingSearchIcon={props.hasLeadingSearchIcon ?? false} />
    </form>
  );
}

function ServerSearchInput(props: Readonly<ServerSearchInputProps>): JSX.Element {
  const onClear: ServerSearchClearHandler = createServerSearchClearHandler(
    props.onSearch,
    props.onInputValueChange,
    props.timeoutRef,
  );

  return (
    <label className="relative block">
      <span className="sr-only">{props.label}</span>
      <ServerSearchLeadingIcon visible={props.hasLeadingSearchIcon} />
      <ServerSearchTextInput {...props} />
      <ServerSearchClearButton onClear={onClear} visible={props.inputValue !== ''} />
    </label>
  );
}

function ServerSearchLeadingIcon({ visible }: Readonly<ServerSearchLeadingIconProps>): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <Search
      aria-hidden="true"
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  );
}

function ServerSearchTextInput({
  hasLeadingSearchIcon,
  inputValue,
  onInputValueChange,
  onSearch,
  placeholder,
  timeoutRef,
}: Readonly<ServerSearchTextInputProps>): JSX.Element {
  return (
    <Input
      className={cn('pr-9', hasLeadingSearchIcon ? 'pl-9' : undefined)}
      name="q"
      onChange={(event: ChangeEvent<HTMLInputElement>): void => {
        handleServerSearchInputChange(event, onSearch, onInputValueChange, timeoutRef);
      }}
      placeholder={placeholder}
      type="search"
      value={inputValue}
    />
  );
}

function ServerSearchClearButton({ onClear, visible }: Readonly<ServerSearchClearButtonProps>): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <button
      aria-label="Clear search"
      className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 shrink-0 cursor-pointer items-center justify-center rounded-micro text-muted-foreground opacity-70 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      onClick={onClear}
      type="button"
    >
      <X aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function createServerSearchSubmitHandler(
  onSearch: ServerSearchSubmitHandler,
  timeoutRef: ServerSearchTimeoutRef,
): ServerSearchFormSubmitHandler {
  return function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    handleServerSearchSubmit(event, onSearch, timeoutRef);
  };
}

function createServerSearchClearHandler(
  onSearch: ServerSearchSubmitHandler,
  onInputValueChange: ServerSearchValueChangeHandler,
  timeoutRef: ServerSearchTimeoutRef,
): ServerSearchClearHandler {
  return function handleClear(event: MouseEvent<HTMLButtonElement>): void {
    handleServerSearchClear(event, onSearch, onInputValueChange, timeoutRef);
  };
}

function handleServerSearchSubmit(
  event: FormEvent<HTMLFormElement>,
  onSearch: ServerSearchSubmitHandler,
  timeoutRef: ServerSearchTimeoutRef,
): void {
  event.preventDefault();
  clearServerSearchTimeout(timeoutRef);
  onSearch(readServerSearchQuery(event.currentTarget));
}

function handleServerSearchClear(
  event: MouseEvent<HTMLButtonElement>,
  onSearch: ServerSearchSubmitHandler,
  onInputValueChange: ServerSearchValueChangeHandler,
  timeoutRef: ServerSearchTimeoutRef,
): void {
  clearServerSearchTimeout(timeoutRef);
  onInputValueChange('');
  onSearch('');
  focusServerSearchInput(event.currentTarget.form);
}

function handleServerSearchInputChange(
  event: ChangeEvent<HTMLInputElement>,
  onSearch: ServerSearchSubmitHandler,
  onInputValueChange: ServerSearchValueChangeHandler,
  timeoutRef: ServerSearchTimeoutRef,
): void {
  const searchQuery: string = event.currentTarget.value;
  onInputValueChange(searchQuery);
  scheduleServerSearchSubmit(searchQuery, onSearch, timeoutRef);
}

function scheduleServerSearchSubmit(
  searchQuery: string,
  onSearch: ServerSearchSubmitHandler,
  timeoutRef: ServerSearchTimeoutRef,
): void {
  clearServerSearchTimeout(timeoutRef);

  timeoutRef.current = window.setTimeout((): void => {
    onSearch(searchQuery);
  }, serverSearchDebounceMs);
}

function readServerSearchQuery(form: HTMLFormElement): string {
  return readServerSearchInput(form)?.value ?? '';
}

function focusServerSearchInput(form: HTMLFormElement | null): void {
  readServerSearchInput(form)?.focus();
}

function readServerSearchInput(form: HTMLFormElement | null): HTMLInputElement | null {
  if (form === null) {
    return null;
  }

  const field: RadioNodeList | Element | null = form.elements.namedItem('q');
  return field instanceof HTMLInputElement ? field : null;
}

function clearServerSearchTimeout(timeoutRef: ServerSearchTimeoutRef): void {
  if (timeoutRef.current === undefined) {
    return;
  }

  window.clearTimeout(timeoutRef.current);
  timeoutRef.current = undefined;
}

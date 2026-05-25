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
import { Input } from './ui/input';
import { X } from './ui/icons';

interface ServerSearchProps {
  children?: ReactNode | undefined;
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

interface ServerSearchTextInputProps {
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

function ServerSearchForm({
  children,
  inputValue,
  label,
  onInputValueChange,
  onSearch,
  placeholder,
  timeoutRef,
}: Readonly<ServerSearchFormProps>): JSX.Element {
  const onSubmit: ServerSearchFormSubmitHandler = createServerSearchSubmitHandler(onSearch, timeoutRef);

  return (
    <form className="w-full max-w-md" onSubmit={onSubmit} role="search">
      {children}
      <ServerSearchInput
        inputValue={inputValue}
        label={label}
        onInputValueChange={onInputValueChange}
        onSearch={onSearch}
        placeholder={placeholder}
        timeoutRef={timeoutRef}
      />
    </form>
  );
}

function ServerSearchInput({
  inputValue,
  label,
  onInputValueChange,
  onSearch,
  placeholder,
  timeoutRef,
}: Readonly<ServerSearchInputProps>): JSX.Element {
  const onClear: ServerSearchClearHandler = createServerSearchClearHandler(onSearch, onInputValueChange, timeoutRef);

  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <ServerSearchTextInput
        inputValue={inputValue}
        onInputValueChange={onInputValueChange}
        onSearch={onSearch}
        placeholder={placeholder}
        timeoutRef={timeoutRef}
      />
      <ServerSearchClearButton onClear={onClear} visible={inputValue !== ''} />
    </label>
  );
}

function ServerSearchTextInput({
  inputValue,
  onInputValueChange,
  onSearch,
  placeholder,
  timeoutRef,
}: Readonly<ServerSearchTextInputProps>): JSX.Element {
  return (
    <Input
      className="pr-9"
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
      className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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

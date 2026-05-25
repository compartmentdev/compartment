import { type ChangeEvent, type JSX, type MouseEvent, useState } from 'react';
import { cn } from '../lib/utils';
import type {
  ComboBoxChangeHandler,
  ComboBoxFocusChangeHandler,
  ComboBoxInputChangeHandler,
  ComboBoxOption,
  ComboBoxProps,
} from './combo-box.types';
import { Input } from './ui/input';

export type { ComboBoxOption } from './combo-box.types';

interface ComboBoxMenuProps {
  emptyMessage: string;
  isLoading: boolean;
  loadingMessage: string;
  onChange: (value: string) => void;
  options: ComboBoxOption[];
}

interface ComboBoxOptionButtonProps {
  onChange: (value: string) => void;
  option: ComboBoxOption;
}

interface ComboBoxStatusMessageProps {
  message: string;
}

const defaultComboBoxLoadingMessage: string = 'Loading options...';
const defaultComboBoxMinQueryLength: number = 1;

export function ComboBox(props: Readonly<ComboBoxProps>): JSX.Element {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={cn('relative', props.className)}>
      <Input
        autoComplete="off"
        className="h-7 w-full"
        disabled={props.disabled}
        onBlur={createComboBoxInputBlurHandler(props.onFocusChange, setIsFocused)}
        onChange={createComboBoxInputChangeHandler(props.onInputChange)}
        onFocus={createComboBoxInputFocusHandler(props.onFocusChange, setIsFocused)}
        placeholder={props.placeholder}
        required={props.required}
        value={props.inputValue}
      />
      {renderComboBoxMenu(props, isFocused, setIsFocused)}
    </div>
  );
}

function renderComboBoxMenu(
  props: Readonly<ComboBoxProps>,
  isFocused: boolean,
  setIsFocused: (value: boolean) => void,
): JSX.Element | null {
  if (!shouldRenderComboBoxMenu(isFocused, props.inputValue, props.minQueryLength)) {
    return null;
  }

  return (
    <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg">
      <ComboBoxMenu
        emptyMessage={props.emptyMessage}
        isLoading={props.isLoading ?? false}
        loadingMessage={props.loadingMessage ?? defaultComboBoxLoadingMessage}
        onChange={createComboBoxOptionSelectHandler(props.onChange, props.onFocusChange, setIsFocused)}
        options={props.options}
      />
    </div>
  );
}

function ComboBoxMenu(props: Readonly<ComboBoxMenuProps>): JSX.Element {
  return <div className="max-h-60 overflow-auto p-1">{renderComboBoxMenuContent(props)}</div>;
}

function renderComboBoxMenuContent(props: Readonly<ComboBoxMenuProps>): JSX.Element {
  if (props.isLoading) {
    return <ComboBoxStatusMessage message={props.loadingMessage} />;
  }
  if (props.options.length === 0) {
    return <ComboBoxStatusMessage message={props.emptyMessage} />;
  }

  return (
    <>
      {props.options.map(
        (option: ComboBoxOption): JSX.Element => (
          <ComboBoxOptionButton key={option.value} onChange={props.onChange} option={option} />
        ),
      )}
    </>
  );
}

function ComboBoxStatusMessage({ message }: Readonly<ComboBoxStatusMessageProps>): JSX.Element {
  return <div className="px-3 py-2 text-[12px] text-muted-foreground">{message}</div>;
}

function ComboBoxOptionButton({ onChange, option }: Readonly<ComboBoxOptionButtonProps>): JSX.Element {
  return (
    <button
      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent"
      onClick={(): void => onChange(option.value)}
      onMouseDown={preventComboBoxOptionMouseDown}
      type="button"
    >
      <span className="truncate">{option.label}</span>
      {option.supportingText === undefined ? null : (
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {option.supportingText}
        </span>
      )}
    </button>
  );
}

function shouldRenderComboBoxMenu(isFocused: boolean, inputValue: string, minQueryLength: number | undefined): boolean {
  return isFocused && inputValue.trim().length >= (minQueryLength ?? defaultComboBoxMinQueryLength);
}

function createComboBoxInputBlurHandler(
  onFocusChange: ComboBoxFocusChangeHandler,
  setIsFocused: (value: boolean) => void,
): () => void {
  return (): void => {
    window.setTimeout((): void => {
      setIsFocused(false);
      onFocusChange?.(false);
    }, 120);
  };
}

function createComboBoxInputChangeHandler(
  onInputChange: ComboBoxInputChangeHandler,
): (event: ChangeEvent<HTMLInputElement>) => void {
  return (event: ChangeEvent<HTMLInputElement>): void => onInputChange(event.target.value);
}

function createComboBoxInputFocusHandler(
  onFocusChange: ComboBoxFocusChangeHandler,
  setIsFocused: (value: boolean) => void,
): () => void {
  return (): void => {
    setIsFocused(true);
    onFocusChange?.(true);
  };
}

function createComboBoxOptionSelectHandler(
  onChange: ComboBoxChangeHandler,
  onFocusChange: ComboBoxFocusChangeHandler,
  setIsFocused: (value: boolean) => void,
): (value: string) => void {
  return (value: string): void => {
    onChange(value);
    setIsFocused(false);
    onFocusChange?.(false);
  };
}

function preventComboBoxOptionMouseDown(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

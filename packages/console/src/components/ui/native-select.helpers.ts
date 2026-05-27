import {
  Children,
  isValidElement,
  useState,
  type ChangeEvent,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import { selectTriggerFieldControlClassName } from './field-styles';
import type {
  NativeSelectChangeHandler,
  NativeOptionValue,
  NativeSelectFieldValue,
  NativeSelectOption,
  NativeSelectState,
  UseNativeSelectModelInput,
  UseNativeSelectModelResult,
} from './native-select.types';

export const emptySelectableOptionRadixValue: string = '__compartment_empty_select_value__';

type NativeOptionElement = ReactElement<OptionHTMLAttributes<HTMLOptionElement>, 'option'>;

interface NativeSelectValueChangeHandlerInput {
  onChange: NativeSelectChangeHandler;
  selectedNativeValue: string;
  setUncontrolledValue: (value: string) => void;
  state: NativeSelectState;
  usesControlledValue: boolean;
}

class NativeSelectModel implements UseNativeSelectModelResult {
  public constructor(
    public readonly onValueChange: (nextRadixValue: string) => void,
    public readonly state: NativeSelectState,
  ) {}
}

export function useNativeSelectModel({
  children,
  defaultValue,
  onChange,
  value,
}: Readonly<UseNativeSelectModelInput>): UseNativeSelectModelResult {
  const [uncontrolledValue, setUncontrolledValue] = useState<string>((): string =>
    readInitialNativeSelectValue(defaultValue, children),
  );
  const state: NativeSelectState = readNativeSelectState(children, value ?? uncontrolledValue);

  return new NativeSelectModel(
    createNativeSelectValueChangeHandler({
      onChange,
      selectedNativeValue: state.selectedNativeValue,
      setUncontrolledValue,
      state,
      usesControlledValue: value !== undefined,
    }),
    state,
  );
}

export function readNativeSelectValueProp(selectedRadixValue: string | undefined): { value?: string } {
  return selectedRadixValue === undefined ? {} : { value: selectedRadixValue };
}

export function readNativeSelectTriggerClassName(className: string | undefined): string {
  return cn(selectTriggerFieldControlClassName, className);
}

export function readNativeSelectItemKey(option: NativeSelectOption, index: number): string {
  return `${option.nativeValue}-${index}`;
}

function createNativeSelectValueChangeHandler({
  onChange,
  selectedNativeValue,
  setUncontrolledValue,
  state,
  usesControlledValue,
}: Readonly<NativeSelectValueChangeHandlerInput>): (nextRadixValue: string) => void {
  return (nextRadixValue: string): void => {
    const nextNativeValue: string = readNativeValueFromRadixValue(state.options, nextRadixValue);
    if (nextNativeValue === selectedNativeValue) {
      return;
    }
    if (!usesControlledValue) {
      setUncontrolledValue(nextNativeValue);
    }
    onChange?.(createNativeSelectChangeEvent(nextNativeValue));
  };
}

function createNativeSelectChangeEvent(nextNativeValue: string): ChangeEvent<HTMLSelectElement> {
  const target: HTMLSelectElement = { value: nextNativeValue } as HTMLSelectElement;
  return { currentTarget: target, target } as ChangeEvent<HTMLSelectElement>;
}

function readNativeSelectState(children: ReactNode, selectedValue: NativeSelectFieldValue): NativeSelectState {
  const options: NativeSelectOption[] = readNativeSelectOptions(children);
  const selectedNativeValue: string = normalizeNativeSelectValue(selectedValue);
  return {
    options,
    placeholderLabel: readPlaceholderLabel(options),
    selectedNativeValue,
    selectedRadixValue: readSelectedRadixValue(options, selectedNativeValue),
  };
}

function readInitialNativeSelectValue(defaultValue: NativeSelectFieldValue, children: ReactNode): string {
  const normalizedDefaultValue: string | undefined = normalizeOptionalNativeSelectValue(defaultValue);
  if (normalizedDefaultValue !== undefined) {
    return normalizedDefaultValue;
  }

  return readNativeSelectOptions(children)[0]?.nativeValue ?? '';
}

function normalizeNativeSelectValue(value: NativeSelectFieldValue): string {
  return normalizeOptionalNativeSelectValue(value) ?? '';
}

function normalizeOptionalNativeSelectValue(value: NativeSelectFieldValue): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isNativeSelectArrayValue(value)) {
    const firstValue: string | undefined = value[0];
    return firstValue;
  }

  return String(value);
}

function isNativeSelectArrayValue(value: NativeSelectFieldValue): value is readonly string[] {
  return Array.isArray(value);
}

function readSelectedRadixValue(options: NativeSelectOption[], selectedNativeValue: string): string | undefined {
  const selectedOption: NativeSelectOption | undefined = options.find(
    (option: NativeSelectOption): boolean => option.nativeValue === selectedNativeValue,
  );
  return selectedOption?.radixValue ?? undefined;
}

function readNativeValueFromRadixValue(options: NativeSelectOption[], nextRadixValue: string): string {
  return options.find((option: NativeSelectOption): boolean => option.radixValue === nextRadixValue)?.nativeValue ?? '';
}

function readPlaceholderLabel(options: NativeSelectOption[]): ReactNode {
  return options.find((option: NativeSelectOption): boolean => option.radixValue === null)?.label ?? '';
}

function readNativeSelectOptions(children: ReactNode): NativeSelectOption[] {
  return Children.toArray(children).flatMap((child: ReactNode): NativeSelectOption[] =>
    isOptionElement(child) ? [toNativeSelectOption(child)] : [],
  );
}

function isOptionElement(child: ReactNode): child is NativeOptionElement {
  return isValidElement(child) && child.type === 'option';
}

function toNativeSelectOption(option: NativeOptionElement): NativeSelectOption {
  const nativeValue: string = normalizeNativeOptionValue(option.props.value, option.props.children);
  return {
    disabled: option.props.disabled ?? false,
    label: option.props.children,
    nativeValue,
    radixValue: readNativeSelectRadixValue(nativeValue, option.props.disabled ?? false),
  };
}

function readNativeSelectRadixValue(nativeValue: string, disabled: boolean): string | null {
  if (nativeValue === '' && disabled) {
    return null;
  }
  if (nativeValue === '') {
    return emptySelectableOptionRadixValue;
  }

  return nativeValue;
}

function normalizeNativeOptionValue(value: NativeOptionValue, fallbackLabel: ReactNode): string {
  if (value !== undefined) {
    return String(value);
  }

  return typeof fallbackLabel === 'string' ? fallbackLabel : '';
}

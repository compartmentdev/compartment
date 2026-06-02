import type { ChangeEvent, ReactNode, RefObject, SelectHTMLAttributes } from 'react';
import type { SingleLineFieldControlSize } from './field-styles';

export type NativeOptionValue = readonly string[] | number | string | undefined;
export type NativeSelectChangeHandler = ((event: ChangeEvent<HTMLSelectElement>) => void) | undefined;
export type NativeSelectFieldValue = readonly string[] | number | string | undefined;

export interface NativeSelectWidthProps extends Pick<
  SelectHTMLAttributes<HTMLSelectElement>,
  | 'aria-describedby'
  | 'aria-label'
  | 'children'
  | 'defaultValue'
  | 'disabled'
  | 'form'
  | 'id'
  | 'name'
  | 'onChange'
  | 'required'
  | 'value'
> {
  className?: string | undefined;
  containerClassName?: string | undefined;
  size?: SingleLineFieldControlSize | undefined;
}

export type NativeSelectPropsWithWidth = Readonly<NativeSelectWidthProps>;

export interface NativeSelectLayoutProps {
  containerClassName: string | undefined;
  hiddenFieldProps: NativeSelectHiddenFieldProps;
  rootProps: NativeSelectRootProps;
}

export interface NativeSelectHiddenFieldInput {
  children: ReactNode;
  disabled: boolean;
  form: string | undefined;
  name: string | undefined;
  required: boolean;
}

export interface NativeSelectHiddenFieldProps {
  children: ReactNode;
  disabled: boolean;
  form: string | undefined;
  name: string | undefined;
  required: boolean;
  selectedNativeValue: string;
}

export interface NativeSelectRootInput {
  ariaDescribedBy: string | undefined;
  ariaLabel: string | undefined;
  className: string | undefined;
  disabled: boolean;
  id: string | undefined;
  required: boolean;
  size: SingleLineFieldControlSize;
}

export interface NativeSelectRootProps {
  ariaDescribedBy: string | undefined;
  ariaLabel: string | undefined;
  className: string | undefined;
  disabled: boolean;
  id: string | undefined;
  onValueChange: (nextRadixValue: string) => void;
  options: NativeSelectOption[];
  placeholderLabel: ReactNode;
  required: boolean;
  selectedRadixValue: string | undefined;
  size: SingleLineFieldControlSize;
}

export interface NativeSelectTriggerButtonProps {
  'aria-describedby': string | undefined;
  'aria-label': string | undefined;
  'aria-labelledby': string | undefined;
  'aria-required': true | undefined;
  className: string;
  id: string | undefined;
  ref: RefObject<HTMLButtonElement | null>;
}

export interface NativeSelectOption {
  disabled: boolean;
  label: ReactNode;
  nativeValue: string;
  radixValue: string | null;
}

export interface NativeSelectState {
  options: NativeSelectOption[];
  placeholderLabel: ReactNode;
  selectedNativeValue: string;
  selectedRadixValue: string | undefined;
}

export interface UseNativeSelectModelInput {
  children: ReactNode;
  defaultValue: NativeSelectFieldValue;
  onChange: NativeSelectChangeHandler;
  value: NativeSelectFieldValue;
}

export type UseNativeSelectModelResult = Readonly<{
  onValueChange: (nextRadixValue: string) => void;
  state: NativeSelectState;
}>;

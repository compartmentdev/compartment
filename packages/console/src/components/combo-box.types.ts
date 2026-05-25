export interface ComboBoxOption {
  label: string;
  supportingText?: string | undefined;
  value: string;
}

export type ComboBoxChangeHandler = (value: string) => void;
export type ComboBoxFocusChangeHandler = ((value: boolean) => void) | undefined;
export type ComboBoxInputChangeHandler = (value: string) => void;

export interface ComboBoxProps {
  className?: string | undefined;
  disabled?: boolean | undefined;
  emptyMessage: string;
  inputValue: string;
  isLoading?: boolean | undefined;
  loadingMessage?: string | undefined;
  minQueryLength?: number | undefined;
  onChange: ComboBoxChangeHandler;
  onFocusChange?: ComboBoxFocusChangeHandler;
  onInputChange: ComboBoxInputChangeHandler;
  options: ComboBoxOption[];
  placeholder: string;
  required?: boolean | undefined;
}

import type { JSX } from 'react';
import { AutocompleteMultiSelect } from './ui/autocomplete-multi-select';

export interface MultiComboBoxOption {
  label: string;
  searchText?: string | undefined;
  value: string;
}

interface MultiComboBoxProps {
  className?: string | undefined;
  disabled?: boolean | undefined;
  emptyMessage: string;
  onChange: (values: string[]) => void;
  options: MultiComboBoxOption[];
  placeholder: string;
  searchPlaceholder: string;
  triggerClassName?: string | undefined;
  values: string[];
}

export function MultiComboBox(props: Readonly<MultiComboBoxProps>): JSX.Element {
  return <AutocompleteMultiSelect {...props} />;
}

import {
  type ChangeEvent,
  type Dispatch,
  type JSX,
  type MutableRefObject,
  type SetStateAction,
  useId,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/utils';
import {
  useFilteredAutocompleteOptions,
  useAutocompleteOutsideClose,
  useAutocompleteQueryReset,
  useSelectedAutocompleteOptions,
} from './autocomplete.helpers';
import { Check } from './icons';
import { Input } from './input';
import { AutocompleteMultiSelectTrigger } from './autocomplete-multi-select-trigger';

interface AutocompleteMultiSelectOption {
  label: string;
  searchText?: string | undefined;
  value: string;
}

interface AutocompleteMultiSelectProps {
  className?: string | undefined;
  disabled?: boolean | undefined;
  emptyMessage: string;
  labelId?: string | undefined;
  onChange: (values: string[]) => void;
  options: AutocompleteMultiSelectOption[];
  placeholder: string;
  searchPlaceholder: string;
  triggerClassName?: string | undefined;
  values: string[];
}

interface AutocompleteMultiSelectMenuProps {
  emptyMessage: string;
  filteredOptions: AutocompleteMultiSelectOption[];
  onChange: (values: string[]) => void;
  query: string;
  searchPlaceholder: string;
  selectedValues: string[];
  setQuery: Dispatch<SetStateAction<string>>;
}

type AutocompleteMultiSelectState = readonly [
  containerRef: MutableRefObject<HTMLDivElement | null>,
  isOpen: boolean,
  onToggle: () => void,
  query: string,
  setQuery: Dispatch<SetStateAction<string>>,
  filteredOptions: AutocompleteMultiSelectOption[],
  selectedOptions: AutocompleteMultiSelectOption[],
];

export function AutocompleteMultiSelect(props: Readonly<AutocompleteMultiSelectProps>): JSX.Element {
  const triggerValueId: string = useId();
  const [containerRef, isOpen, onToggle, query, setQuery, filteredOptions, selectedOptions] =
    useAutocompleteMultiSelectState(props);

  return (
    <div className={cn('relative', props.className)} ref={containerRef}>
      <AutocompleteMultiSelectTrigger
        disabled={props.disabled}
        isOpen={isOpen}
        labelId={props.labelId}
        onClick={onToggle}
        placeholder={props.placeholder}
        selectedOptions={selectedOptions}
        triggerClassName={props.triggerClassName}
        valueId={triggerValueId}
      />
      {renderAutocompleteMultiSelectMenu(props, isOpen, query, setQuery, filteredOptions)}
    </div>
  );
}

function renderAutocompleteMultiSelectMenu(
  props: Readonly<AutocompleteMultiSelectProps>,
  isOpen: boolean,
  query: string,
  setQuery: Dispatch<SetStateAction<string>>,
  filteredOptions: AutocompleteMultiSelectOption[],
): JSX.Element | null {
  if (!isOpen) {
    return null;
  }

  return (
    <AutocompleteMultiSelectMenu
      emptyMessage={props.emptyMessage}
      filteredOptions={filteredOptions}
      onChange={props.onChange}
      query={query}
      searchPlaceholder={props.searchPlaceholder}
      selectedValues={props.values}
      setQuery={setQuery}
    />
  );
}

function AutocompleteMultiSelectMenu(props: Readonly<AutocompleteMultiSelectMenuProps>): JSX.Element {
  return (
    <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg">
      <AutocompleteMultiSelectSearchInput
        query={props.query}
        searchPlaceholder={props.searchPlaceholder}
        setQuery={props.setQuery}
      />
      <AutocompleteMultiSelectMenuContent props={props} />
    </div>
  );
}

function AutocompleteMultiSelectSearchInput({
  query,
  searchPlaceholder,
  setQuery,
}: Readonly<Pick<AutocompleteMultiSelectMenuProps, 'query' | 'searchPlaceholder' | 'setQuery'>>): JSX.Element {
  return (
    <div className="border-b border-border p-2">
      <Input
        autoFocus
        className="h-7"
        onChange={(event: ChangeEvent<HTMLInputElement>): void => setQuery(event.target.value)}
        placeholder={searchPlaceholder}
        value={query}
      />
    </div>
  );
}

function AutocompleteMultiSelectMenuContent({
  props,
}: Readonly<{ props: AutocompleteMultiSelectMenuProps }>): JSX.Element {
  return (
    <div className="max-h-60 overflow-auto p-1">
      {props.filteredOptions.length === 0 ? (
        <AutocompleteMultiSelectEmptyState message={props.emptyMessage} />
      ) : (
        props.filteredOptions.map(
          (option: AutocompleteMultiSelectOption): JSX.Element => (
            <AutocompleteMultiSelectOptionRow
              key={option.value}
              onChange={props.onChange}
              option={option}
              selectedValues={props.selectedValues}
            />
          ),
        )
      )}
    </div>
  );
}

function AutocompleteMultiSelectEmptyState({ message }: Readonly<{ message: string }>): JSX.Element {
  return <div className="px-3 py-2 text-[12px] text-muted-foreground">{message}</div>;
}

function AutocompleteMultiSelectOptionRow({
  onChange,
  option,
  selectedValues,
}: Readonly<{
  onChange: (values: string[]) => void;
  option: AutocompleteMultiSelectOption;
  selectedValues: string[];
}>): JSX.Element {
  const isSelected: boolean = selectedValues.includes(option.value);

  return (
    <button
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent',
        isSelected ? 'bg-accent/70' : undefined,
      )}
      onClick={(): void => onChange(readNextAutocompleteValues(selectedValues, option.value))}
      type="button"
    >
      <span className="truncate">{option.label}</span>
      {isSelected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
    </button>
  );
}

function readNextAutocompleteValues(selectedValues: string[], value: string): string[] {
  return selectedValues.includes(value)
    ? selectedValues.filter((current: string): boolean => current !== value)
    : [...selectedValues, value];
}

function useAutocompleteMultiSelectState(props: Readonly<AutocompleteMultiSelectProps>): AutocompleteMultiSelectState {
  const containerRef: MutableRefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredOptions: AutocompleteMultiSelectOption[] = useFilteredAutocompleteOptions(props.options, query);
  const selectedOptions: AutocompleteMultiSelectOption[] = useSelectedAutocompleteOptions(props.options, props.values);

  useAutocompleteOutsideClose(containerRef, isOpen, setIsOpen);
  useAutocompleteQueryReset(isOpen, setQuery);

  return [
    containerRef,
    isOpen,
    (): void => setIsOpen((current: boolean): boolean => !current),
    query,
    setQuery,
    filteredOptions,
    selectedOptions,
  ];
}

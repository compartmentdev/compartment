import type { JSX } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { ChevronDown } from './icons';

interface AutocompleteMultiSelectOption {
  label: string;
  searchText?: string | undefined;
  value: string;
}

interface AutocompleteMultiSelectTriggerProps {
  disabled?: boolean | undefined;
  isOpen: boolean;
  labelId?: string | undefined;
  onClick: () => void;
  placeholder: string;
  selectedOptions: AutocompleteMultiSelectOption[];
  triggerClassName?: string | undefined;
  valueId: string;
}

export function AutocompleteMultiSelectTrigger(props: Readonly<AutocompleteMultiSelectTriggerProps>): JSX.Element {
  return (
    <button
      aria-labelledby={readAutocompleteMultiSelectLabelledBy(props.labelId, props.valueId)}
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 overflow-hidden rounded-md border border-input bg-background px-3 text-left text-[13px] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        props.isOpen && props.triggerClassName === undefined
          ? 'ring-2 ring-ring/60 ring-offset-2 ring-offset-background'
          : undefined,
        props.triggerClassName,
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      <AutocompleteMultiSelectTriggerValue
        placeholder={props.placeholder}
        selectedOptions={props.selectedOptions}
        valueId={props.valueId}
      />
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function AutocompleteMultiSelectTriggerValue({
  placeholder,
  selectedOptions,
  valueId,
}: Readonly<Pick<AutocompleteMultiSelectTriggerProps, 'placeholder' | 'selectedOptions' | 'valueId'>>): JSX.Element {
  if (selectedOptions.length === 0) {
    return (
      <span className="truncate text-muted-foreground" id={valueId}>
        {placeholder}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" id={valueId}>
      {selectedOptions.map(
        (option: AutocompleteMultiSelectOption): JSX.Element => (
          <AutocompleteMultiSelectTriggerBadge key={option.value} option={option} />
        ),
      )}
    </span>
  );
}

function AutocompleteMultiSelectTriggerBadge({
  option,
}: Readonly<{ option: AutocompleteMultiSelectOption }>): JSX.Element {
  return (
    <Badge
      className="h-5 max-w-full shrink-0 rounded-full border border-[var(--cpt-border-default,rgba(0,0,0,0.08))] bg-background px-1.5 py-0 text-[11px] font-medium leading-4"
      variant="outline"
    >
      <span className="truncate">{option.label}</span>
    </Badge>
  );
}

function readAutocompleteMultiSelectLabelledBy(labelId: string | undefined, valueId: string): string | undefined {
  return labelId === undefined ? undefined : `${labelId} ${valueId}`;
}

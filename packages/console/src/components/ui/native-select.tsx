import * as SelectPrimitive from '@radix-ui/react-select';
import { useEffect, useId, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/utils';
import { Check, ChevronDown } from './icons';
import {
  emptySelectableOptionRadixValue,
  readNativeSelectItemKey,
  readNativeSelectTriggerClassName,
  readNativeSelectValueProp,
  useNativeSelectModel,
} from './native-select.helpers';
import type {
  NativeSelectHiddenFieldProps,
  NativeSelectOption,
  NativeSelectPropsWithWidth,
  NativeSelectRootProps,
  UseNativeSelectModelResult,
} from './native-select.types';

interface NativeSelectLayoutProps {
  containerClassName: string | undefined;
  hiddenFieldProps: NativeSelectHiddenFieldProps;
  rootProps: NativeSelectRootProps;
}

interface NativeSelectRootInput {
  ariaDescribedBy: string | undefined;
  ariaLabel: string | undefined;
  className: string | undefined;
  disabled: boolean;
  id: string | undefined;
  required: boolean;
}

interface NativeSelectHiddenFieldInput {
  children: ReactNode;
  disabled: boolean;
  form: string | undefined;
  name: string | undefined;
  required: boolean;
}

interface NativeSelectRootComponentProps {
  props: NativeSelectRootProps;
}

interface NativeSelectTriggerProps {
  labelledBy: string | undefined;
  props: NativeSelectRootProps;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function NativeSelect(props: NativeSelectPropsWithWidth): JSX.Element {
  const layoutProps: NativeSelectLayoutProps = useNativeSelectLayoutProps(props);
  return <NativeSelectLayout props={layoutProps} />;
}

function NativeSelectLayout({ props }: Readonly<{ props: NativeSelectLayoutProps }>): JSX.Element {
  return (
    <span className={cn('relative grid', props.containerClassName)}>
      <NativeSelectHiddenField props={props.hiddenFieldProps} />
      <NativeSelectRoot props={props.rootProps} />
    </span>
  );
}

function useNativeSelectLayoutProps({
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  children,
  className,
  containerClassName,
  defaultValue,
  disabled = false,
  form,
  id,
  name,
  onChange,
  required = false,
  value,
}: NativeSelectPropsWithWidth): NativeSelectLayoutProps {
  const model: UseNativeSelectModelResult = useNativeSelectModel({ children, defaultValue, onChange, value });
  return {
    containerClassName,
    hiddenFieldProps: readNativeSelectHiddenFieldProps({ children, disabled, form, name, required }, model),
    rootProps: readNativeSelectRootProps({ ariaDescribedBy, ariaLabel, className, disabled, id, required }, model),
  };
}

function readNativeSelectHiddenFieldProps(
  props: Readonly<NativeSelectHiddenFieldInput>,
  model: UseNativeSelectModelResult,
): NativeSelectHiddenFieldProps {
  return {
    children: props.children,
    disabled: props.disabled,
    form: props.form,
    name: props.name,
    required: props.required,
    selectedNativeValue: model.state.selectedNativeValue,
  };
}

function readNativeSelectRootProps(
  props: Readonly<NativeSelectRootInput>,
  model: UseNativeSelectModelResult,
): NativeSelectRootProps {
  return {
    ariaDescribedBy: props.ariaDescribedBy,
    ariaLabel: props.ariaLabel,
    className: props.className,
    disabled: props.disabled,
    id: props.id,
    onValueChange: model.onValueChange,
    options: model.state.options,
    placeholderLabel: model.state.placeholderLabel,
    required: props.required,
    selectedRadixValue: model.state.selectedRadixValue,
  };
}

function NativeSelectRoot({ props }: Readonly<NativeSelectRootComponentProps>): JSX.Element {
  const [derivedLabelledBy, triggerRef]: readonly [string | undefined, RefObject<HTMLButtonElement | null>] =
    useNativeSelectTriggerLabelledBy(props.ariaLabel);

  return (
    <SelectPrimitive.Root
      disabled={props.disabled}
      onValueChange={props.onValueChange}
      {...readNativeSelectValueProp(props.selectedRadixValue)}
    >
      <NativeSelectTrigger labelledBy={derivedLabelledBy} props={props} triggerRef={triggerRef} />
      <NativeSelectContent options={props.options} />
    </SelectPrimitive.Root>
  );
}

function NativeSelectHiddenField({ props }: Readonly<{ props: NativeSelectHiddenFieldProps }>): JSX.Element | null {
  return props.name === undefined ? null : (
    <select
      aria-hidden="true"
      className="absolute m-[-1px] size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]"
      disabled={props.disabled}
      form={props.form}
      name={props.name}
      onChange={readNativeSelectHiddenFieldChange}
      required={props.required}
      tabIndex={-1}
      value={props.selectedNativeValue}
    >
      {props.children}
    </select>
  );
}

function NativeSelectTrigger({ labelledBy, props, triggerRef }: Readonly<NativeSelectTriggerProps>): JSX.Element {
  return (
    <SelectPrimitive.Trigger {...readNativeSelectTriggerProps(props, labelledBy, triggerRef)}>
      <SelectPrimitive.Value placeholder={props.placeholderLabel} />
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function readNativeSelectHiddenFieldChange(): void {
  return;
}

function readNativeSelectTriggerProps(
  props: NativeSelectRootProps,
  labelledBy: string | undefined,
  triggerRef: RefObject<HTMLButtonElement | null>,
): {
  'aria-describedby': string | undefined;
  'aria-label': string | undefined;
  'aria-labelledby': string | undefined;
  'aria-required': true | undefined;
  className: string;
  id: string | undefined;
  ref: RefObject<HTMLButtonElement | null>;
} {
  return {
    'aria-describedby': props.ariaDescribedBy,
    'aria-label': props.ariaLabel,
    'aria-labelledby': labelledBy,
    'aria-required': props.required || undefined,
    className: readNativeSelectTriggerClassName(props.className),
    id: props.id,
    ref: triggerRef,
  };
}

function useNativeSelectTriggerLabelledBy(
  ariaLabel: string | undefined,
): readonly [string | undefined, RefObject<HTMLButtonElement | null>] {
  const generatedLabelId: string = useId();
  const triggerRef: RefObject<HTMLButtonElement | null> = useRef<HTMLButtonElement | null>(null);
  const [labelledBy, setLabelledBy] = useState<string | undefined>(undefined);

  useEffect((): void => {
    if (ariaLabel !== undefined) {
      setLabelledBy(undefined);
      return;
    }

    const trigger: HTMLButtonElement | null = triggerRef.current;
    const label: HTMLLabelElement | null = trigger === null ? null : trigger.closest('label');
    if (label === null) {
      setLabelledBy(undefined);
      return;
    }

    if (label.id === '') {
      label.id = readNativeSelectLabelId(generatedLabelId);
    }

    setLabelledBy(label.id);
  }, [ariaLabel, generatedLabelId]);

  return [labelledBy, triggerRef] as const;
}

function readNativeSelectLabelId(generatedLabelId: string): string {
  return `native-select-label-${generatedLabelId}`;
}

function NativeSelectContent({ options }: Readonly<{ options: NativeSelectOption[] }>): JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        position="popper"
        sideOffset={4}
      >
        <SelectPrimitive.Viewport className="max-h-[var(--radix-select-content-available-height)] overflow-y-auto p-1">
          {renderNativeSelectItems(options)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function renderNativeSelectItems(options: NativeSelectOption[]): JSX.Element[] {
  return options
    .filter((option: NativeSelectOption): boolean => option.radixValue !== null)
    .map(
      (option: NativeSelectOption, index: number): JSX.Element => (
        <NativeSelectItem key={readNativeSelectItemKey(option, index)} option={option} />
      ),
    );
}

function NativeSelectItem({ option }: Readonly<{ option: NativeSelectOption }>): JSX.Element {
  return (
    <SelectPrimitive.Item
      className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-[13px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
      disabled={option.disabled}
      value={option.radixValue ?? emptySelectableOptionRadixValue}
    >
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

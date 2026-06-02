import * as SelectPrimitive from '@radix-ui/react-select';
import { useEffect, useId, useRef, useState, type JSX, type RefObject } from 'react';
import { cn } from '../../lib/utils';
import { Check, ChevronDown } from './icons';
import {
  emptySelectableOptionRadixValue,
  readNativeSelectItemKey,
  readNativeSelectHiddenFieldProps,
  readNativeSelectLabelId,
  readNativeSelectRootProps,
  readNativeSelectTriggerProps,
  readNativeSelectValueProp,
  useNativeSelectModel,
} from './native-select.helpers';
import type {
  NativeSelectHiddenFieldProps,
  NativeSelectHiddenFieldInput,
  NativeSelectLayoutProps,
  NativeSelectOption,
  NativeSelectPropsWithWidth,
  NativeSelectRootInput,
  NativeSelectRootProps,
  UseNativeSelectModelResult,
} from './native-select.types';

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
  return (
    <span className={cn('relative grid', layoutProps.containerClassName)}>
      <NativeSelectHiddenField props={layoutProps.hiddenFieldProps} />
      <NativeSelectRoot props={layoutProps.rootProps} />
    </span>
  );
}

function useNativeSelectLayoutProps(props: NativeSelectPropsWithWidth): NativeSelectLayoutProps {
  const disabled: boolean = props.disabled ?? false;
  const required: boolean = props.required ?? false;
  const model: UseNativeSelectModelResult = useNativeSelectModel({
    children: props.children,
    defaultValue: props.defaultValue,
    onChange: props.onChange,
    value: props.value,
  });
  return {
    containerClassName: props.containerClassName,
    hiddenFieldProps: readNativeSelectHiddenFieldProps(
      readNativeSelectHiddenFieldInput(props, disabled, required),
      model,
    ),
    rootProps: readNativeSelectRootProps(readNativeSelectRootInput(props, disabled, required), model),
  };
}

function readNativeSelectHiddenFieldInput(
  props: NativeSelectPropsWithWidth,
  disabled: boolean,
  required: boolean,
): NativeSelectHiddenFieldInput {
  return { children: props.children, disabled, form: props.form, name: props.name, required };
}

function readNativeSelectRootInput(
  props: NativeSelectPropsWithWidth,
  disabled: boolean,
  required: boolean,
): NativeSelectRootInput {
  return {
    ariaDescribedBy: props['aria-describedby'],
    ariaLabel: props['aria-label'],
    className: props.className,
    disabled,
    id: props.id,
    required,
    size: props.size ?? 'sm',
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

function NativeSelectContent({ options }: Readonly<{ options: NativeSelectOption[] }>): JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-field border border-border bg-popover text-popover-foreground shadow-md"
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
      className="relative flex w-full cursor-pointer select-none items-center rounded-micro py-1.5 pl-2 pr-8 text-[13px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
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

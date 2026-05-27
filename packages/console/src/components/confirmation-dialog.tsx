import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  StyledAlertDialogCancel,
} from './ui/alert-dialog';
import { Input } from './ui/input';

interface ConfirmationDialogProps {
  cancelLabel?: string | undefined;
  confirmLabel: string;
  description: string;
  expectedValue?: string | undefined;
  inputLabel?: string | undefined;
  inputPlaceholder?: string | undefined;
  isPending?: boolean | undefined;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}
interface ConfirmationDialogLayoutProps {
  dialog: ConfirmationDialogProps;
  state: ConfirmationDialogState;
}
interface ConfirmationDialogFooterActionsProps {
  cancelLabel: string;
  confirmLabel: string;
  isConfirmDisabled: boolean;
  isPending: boolean;
}
interface ConfirmationDialogSnapshot {
  cancelLabel: string;
  confirmLabel: string;
  description: string;
  expectedValue?: string | undefined;
  inputLabel?: string | undefined;
  inputPlaceholder?: string | undefined;
  title: string;
}
interface ConfirmationDialogState {
  confirmationValue: string;
  inputId: string;
  isConfirmDisabled: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ConfirmationDialogSnapshot;
  setConfirmationValue: (value: string) => void;
}
interface ExactMatchConfirmationFieldProps {
  inputId: string;
  inputLabel?: string | undefined;
  inputPlaceholder?: string | undefined;
  isPending: boolean;
  onChange: (value: string) => void;
  value: string;
}
class ConfirmationDialogStateValue implements ConfirmationDialogState {
  public constructor(
    public readonly confirmationValue: string,
    public readonly inputId: string,
    public readonly isConfirmDisabled: boolean,
    public readonly onOpenChange: (open: boolean) => void,
    public readonly snapshot: ConfirmationDialogSnapshot,
    public readonly setConfirmationValue: (value: string) => void,
  ) {}
}
export function ConfirmationDialog(props: Readonly<ConfirmationDialogProps>): JSX.Element {
  return <ConfirmationDialogLayout dialog={props} state={useConfirmationDialogState(props)} />;
}
function useConfirmationDialogState(dialog: Readonly<ConfirmationDialogProps>): ConfirmationDialogState {
  const inputId: string = useId();
  const [confirmationValue, setConfirmationValue] = useConfirmationValue(dialog.open);
  const snapshot: ConfirmationDialogSnapshot = useConfirmationDialogSnapshot(dialog);

  return new ConfirmationDialogStateValue(
    confirmationValue,
    inputId,
    readIsConfirmDisabled(snapshot.expectedValue, confirmationValue, dialog.isPending ?? false),
    readConfirmationOpenChangeHandler(dialog.isPending ?? false, dialog.onOpenChange),
    snapshot,
    setConfirmationValue,
  );
}
function useConfirmationDialogSnapshot(dialog: Readonly<ConfirmationDialogProps>): ConfirmationDialogSnapshot {
  const snapshotRef: { current: ConfirmationDialogSnapshot } = useRef<ConfirmationDialogSnapshot>(
    readConfirmationDialogSnapshot(dialog),
  );
  const wasOpenRef: { current: boolean } = useRef<boolean>(dialog.open);
  if (!dialog.open || !wasOpenRef.current) {
    snapshotRef.current = readConfirmationDialogSnapshot(dialog);
  }
  wasOpenRef.current = dialog.open;
  return snapshotRef.current;
}
function ConfirmationDialogLayout({ dialog, state }: Readonly<ConfirmationDialogLayoutProps>): JSX.Element {
  return (
    <AlertDialog open={dialog.open} onOpenChange={state.onOpenChange}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={readConfirmationSubmitHandler(dialog.onConfirm, state.isConfirmDisabled)}
        >
          <ConfirmationDialogBody dialog={state.snapshot} isPending={dialog.isPending ?? false} state={state} />
          <ConfirmationDialogFooterActions
            cancelLabel={state.snapshot.cancelLabel}
            confirmLabel={state.snapshot.confirmLabel}
            isConfirmDisabled={state.isConfirmDisabled}
            isPending={dialog.isPending ?? false}
          />
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
function useConfirmationValue(open: boolean): [string, (value: string) => void] {
  const [confirmationValue, setConfirmationValue] = useState<string>('');
  useEffect((): void => {
    if (!open) {
      setConfirmationValue('');
    }
  }, [open]);
  return [confirmationValue, setConfirmationValue];
}
function readIsConfirmDisabled(
  expectedValue: string | undefined,
  confirmationValue: string,
  isPending: boolean,
): boolean {
  return isPending || (expectedValue !== undefined && confirmationValue !== expectedValue);
}
function readConfirmationOpenChangeHandler(
  isPending: boolean,
  onOpenChange: (open: boolean) => void,
): (open: boolean) => void {
  return (open: boolean): void => {
    if (!isPending) {
      onOpenChange(open);
    }
  };
}
function readConfirmationDialogSnapshot(dialog: Readonly<ConfirmationDialogProps>): ConfirmationDialogSnapshot {
  return {
    cancelLabel: dialog.cancelLabel ?? 'Cancel',
    confirmLabel: dialog.confirmLabel,
    description: dialog.description,
    expectedValue: dialog.expectedValue,
    inputLabel: dialog.inputLabel,
    inputPlaceholder: dialog.inputPlaceholder,
    title: dialog.title,
  };
}
function readConfirmationSubmitHandler(
  onConfirm: () => void,
  isConfirmDisabled: boolean,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!isConfirmDisabled) {
      onConfirm();
    }
  };
}
function ConfirmationDialogBody({
  dialog,
  isPending,
  state,
}: Readonly<{ dialog: ConfirmationDialogSnapshot; isPending: boolean; state: ConfirmationDialogState }>): JSX.Element {
  return (
    <>
      <ConfirmationDialogHeader description={dialog.description} title={dialog.title} />
      <ExactMatchConfirmationSection dialog={dialog} isPending={isPending} state={state} />
    </>
  );
}
function ConfirmationDialogHeader({
  description,
  title,
}: Readonly<Pick<ConfirmationDialogSnapshot, 'description' | 'title'>>): JSX.Element {
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>{description}</AlertDialogDescription>
    </AlertDialogHeader>
  );
}
function ExactMatchConfirmationSection({
  dialog,
  isPending,
  state,
}: Readonly<{
  dialog: ConfirmationDialogSnapshot;
  isPending: boolean;
  state: ConfirmationDialogState;
}>): JSX.Element | null {
  if (dialog.expectedValue === undefined) {
    return null;
  }
  return (
    <ExactMatchConfirmationField
      inputId={state.inputId}
      inputLabel={dialog.inputLabel}
      inputPlaceholder={dialog.inputPlaceholder}
      isPending={isPending}
      onChange={state.setConfirmationValue}
      value={state.confirmationValue}
    />
  );
}
function ConfirmationDialogFooterActions({
  cancelLabel,
  confirmLabel,
  isConfirmDisabled,
  isPending,
}: Readonly<ConfirmationDialogFooterActionsProps>): JSX.Element {
  return (
    <AlertDialogFooter>
      <StyledAlertDialogCancel disabled={isPending} type="button">
        {cancelLabel}
      </StyledAlertDialogCancel>
      <Button disabled={isConfirmDisabled} type="submit" variant="destructive">
        {confirmLabel}
      </Button>
    </AlertDialogFooter>
  );
}
function ExactMatchConfirmationField(props: Readonly<ExactMatchConfirmationFieldProps>): JSX.Element {
  return (
    <div className="grid gap-1.5">
      <label className="text-[12px] font-medium leading-4 text-foreground" htmlFor={props.inputId}>
        {props.inputLabel ?? 'Confirmation value'}
      </label>
      <Input
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        disabled={props.isPending}
        id={props.inputId}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => props.onChange(event.target.value)}
        placeholder={props.inputPlaceholder}
        value={props.value}
      />
    </div>
  );
}

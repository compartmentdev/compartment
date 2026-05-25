import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { cn } from '../lib/utils';
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from './ui/icons';

type DismissibleAlertVariant = 'error' | 'info' | 'notice' | 'warning';
type DismissibleMessageDismissHandler = (messageKey: string | null) => void;

interface DismissibleAlertProps {
  className?: string | undefined;
  message: string | undefined;
  messageId?: number | string | undefined;
  variant: DismissibleAlertVariant;
}

interface DismissibleAlertCloseButtonProps {
  className: string;
  onDismiss: () => void;
}

interface DismissibleAlertContentProps {
  className?: string | undefined;
  message: string;
  messageKey: string;
  onDismiss: DismissibleMessageDismissHandler;
  variant: DismissibleAlertVariant;
}

interface DismissibleAlertState {
  dismissMessage: DismissibleMessageDismissHandler;
  isVisible: boolean;
  messageKey: string | null;
}

interface DismissibleAlertTone {
  borderColor: string;
  closeButtonClassName: string;
  containerClassName: string;
  icon: LucideIcon;
  iconClassName: string;
}

const dismissibleAlertTones: Record<DismissibleAlertVariant, DismissibleAlertTone> = {
  error: {
    borderColor: 'var(--toast-border-error)',
    closeButtonClassName:
      'text-[var(--toast-text-error)]/85 hover:text-[var(--toast-text-error)] focus-visible:ring-[var(--toast-text-error)]/20',
    containerClassName: 'bg-[var(--toast-bg-error)] text-[var(--toast-text-error)]',
    icon: CircleX,
    iconClassName: 'size-4 shrink-0 text-[var(--toast-text-error)]',
  },
  info: {
    borderColor: 'var(--toast-border-info)',
    closeButtonClassName:
      'text-[var(--toast-text-info)]/85 hover:text-[var(--toast-text-info)] focus-visible:ring-[var(--toast-text-info)]/20',
    containerClassName: 'bg-[var(--toast-bg-info)] text-[var(--toast-text-info)]',
    icon: Info,
    iconClassName: 'size-4 shrink-0 text-[var(--toast-text-info)]',
  },
  notice: {
    borderColor: 'var(--toast-border-success)',
    closeButtonClassName:
      'text-[var(--toast-text-success)]/85 hover:text-[var(--toast-text-success)] focus-visible:ring-[var(--toast-text-success)]/20',
    containerClassName: 'bg-[var(--toast-bg-success)] text-[var(--toast-text-success)]',
    icon: CircleCheck,
    iconClassName: 'size-4 shrink-0 text-[var(--toast-text-success)]',
  },
  warning: {
    borderColor: 'var(--toast-border-warning)',
    closeButtonClassName:
      'text-[var(--toast-text-warning)]/85 hover:text-[var(--toast-text-warning)] focus-visible:ring-[var(--toast-text-warning)]/20',
    containerClassName: 'bg-[var(--toast-bg-warning)] text-[var(--toast-text-warning)]',
    icon: TriangleAlert,
    iconClassName: 'size-4 shrink-0 text-[var(--toast-text-warning)]',
  },
};

interface AutoDismissMessageInput {
  isVisible: boolean;
  messageKey: string | null;
  onDismiss: DismissibleMessageDismissHandler;
}

const dismissibleAlertTimeoutMs: number = 5000;

export function DismissibleAlert({
  className,
  message,
  messageId,
  variant,
}: Readonly<DismissibleAlertProps>): JSX.Element | null {
  const alertState: DismissibleAlertState = useDismissibleAlertState(message, messageId, variant);

  if (!alertState.isVisible || message === undefined || alertState.messageKey === null) {
    return null;
  }

  const visibleMessageKey: string = alertState.messageKey;

  return (
    <DismissibleAlertContent
      className={className}
      message={message}
      messageKey={visibleMessageKey}
      onDismiss={alertState.dismissMessage}
      variant={variant}
    />
  );
}

function DismissibleAlertContent(props: Readonly<DismissibleAlertContentProps>): JSX.Element {
  const { className, message, messageKey, onDismiss, variant } = props;
  const tone: DismissibleAlertTone = readDismissibleAlertTone(variant);
  const ToneIcon: LucideIcon = tone.icon;
  const containerStyle: CSSProperties = readDismissibleAlertContainerStyle(tone);
  const handleDismiss: () => void = createDismissibleAlertDismissHandler(messageKey, onDismiss);
  const containerClassName: string = cn(
    'flex items-center gap-2.5 rounded-[8px] border px-2.5 py-2 text-[13px] leading-[18px]',
    tone.containerClassName,
    className,
  );

  return (
    <div className={containerClassName} role={readDismissibleAlertRole(variant)} style={containerStyle}>
      <ToneIcon aria-hidden="true" className={tone.iconClassName} />
      <DismissibleAlertMessage message={message} />
      <DismissibleAlertCloseButton className={tone.closeButtonClassName} onDismiss={handleDismiss} />
    </div>
  );
}

function DismissibleAlertCloseButton({
  className,
  onDismiss,
}: Readonly<DismissibleAlertCloseButtonProps>): JSX.Element {
  return (
    <button
      aria-label="Dismiss message"
      className={cn(
        'inline-flex -m-0.5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
      onClick={onDismiss}
      type="button"
    >
      <X aria-hidden="true" className="size-3" />
    </button>
  );
}

function DismissibleAlertMessage({ message }: Readonly<{ message: string }>): JSX.Element {
  return <p className="m-0 min-w-0 flex-1">{message}</p>;
}

function useDismissibleAlertState(
  message: string | undefined,
  messageId: number | string | undefined,
  variant: DismissibleAlertVariant,
): DismissibleAlertState {
  const [dismissedMessageKey, setDismissedMessageKey] = useState<string | null>(null);
  const messageKey: string | null = readDismissibleMessageKey(message, messageId, variant);
  const isVisible: boolean = messageKey !== null && dismissedMessageKey !== messageKey;

  useResetDismissedMessage(messageKey, setDismissedMessageKey);
  useAutoDismissMessage({
    isVisible,
    messageKey,
    onDismiss: setDismissedMessageKey,
  });

  return { dismissMessage: setDismissedMessageKey, isVisible, messageKey };
}

function useResetDismissedMessage(messageKey: string | null, onDismiss: DismissibleMessageDismissHandler): void {
  useEffect((): void => {
    if (messageKey === null) {
      onDismiss(null);
    }
  }, [messageKey, onDismiss]);
}

function useAutoDismissMessage({ isVisible, messageKey, onDismiss }: Readonly<AutoDismissMessageInput>): void {
  useEffect((): (() => void) | undefined => {
    if (!isVisible || messageKey === null) {
      return undefined;
    }

    const timeoutId: number = window.setTimeout((): void => {
      onDismiss(messageKey);
    }, dismissibleAlertTimeoutMs);

    return (): void => {
      window.clearTimeout(timeoutId);
    };
  }, [isVisible, messageKey, onDismiss]);
}

function readDismissibleMessageKey(
  message: string | undefined,
  messageId: number | string | undefined,
  variant: DismissibleAlertVariant,
): string | null {
  if (message === undefined) {
    return null;
  }

  return messageId === undefined ? `${variant}:${message}` : `${variant}:${messageId}:${message}`;
}

function readDismissibleAlertTone(variant: DismissibleAlertVariant): DismissibleAlertTone {
  return dismissibleAlertTones[variant];
}

function readDismissibleAlertContainerStyle(tone: DismissibleAlertTone): CSSProperties {
  return { borderColor: tone.borderColor };
}

function createDismissibleAlertDismissHandler(
  messageKey: string,
  onDismiss: DismissibleMessageDismissHandler,
): () => void {
  return (): void => onDismiss(messageKey);
}

function readDismissibleAlertRole(variant: DismissibleAlertVariant): 'alert' | 'status' {
  switch (variant) {
    case 'error':
      return 'alert';
    case 'warning':
      return 'alert';
    case 'info':
    case 'notice':
      return 'status';
  }
}

import { useCallback, useRef, useState, type JSX, type RefObject } from 'react';
import { Check, Copy } from '../../components/ui/icons';
import { Button } from '../../components/ui/button';

type OnboardingCommandCopyStatus = 'copied' | 'failed' | 'idle';

interface OnboardingCommandBlockProps {
  command: string;
}

interface OnboardingCommandCopyButtonProps {
  onCopy: () => void;
  status: OnboardingCommandCopyStatus;
}

interface OnboardingCommandBlockViewProps extends OnboardingCommandBlockProps, OnboardingCommandCopyButtonProps {
  commandRef: RefObject<HTMLPreElement | null>;
}

interface OnboardingCommandViewProps extends OnboardingCommandBlockProps {
  commandRef: RefObject<HTMLPreElement | null>;
}

export function OnboardingCommandBlock({ command }: Readonly<OnboardingCommandBlockProps>): JSX.Element {
  const [copyStatus, setCopyStatus] = useState<OnboardingCommandCopyStatus>('idle');
  const commandRef: RefObject<HTMLPreElement | null> = useRef<HTMLPreElement>(null);
  const copyCommand: () => void = useCallback((): void => {
    void copyTextToClipboard(command, commandRef.current)
      .then((): void => updateCopyStatus(setCopyStatus, 'copied'))
      .catch((): void => updateCopyStatus(setCopyStatus, 'failed'));
  }, [command]);

  return (
    <OnboardingCommandBlockView command={command} commandRef={commandRef} onCopy={copyCommand} status={copyStatus} />
  );
}

function OnboardingCommandBlockView({
  command,
  commandRef,
  onCopy,
  status,
}: Readonly<OnboardingCommandBlockViewProps>): JSX.Element {
  return (
    <div className="mt-3 overflow-hidden rounded-field border border-black/10 bg-[#111212]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <OnboardingCommandView command={command} commandRef={commandRef} />
        <OnboardingCommandCopyButton onCopy={onCopy} status={status} />
      </div>
    </div>
  );
}

function OnboardingCommandView({ command, commandRef }: Readonly<OnboardingCommandViewProps>): JSX.Element {
  return (
    <pre
      aria-label="Command to run"
      className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 font-mono text-[13px] leading-5 text-white [overflow-wrap:anywhere]"
      ref={commandRef}
    >
      <code>{command}</code>
    </pre>
  );
}

function OnboardingCommandCopyButton({ onCopy, status }: Readonly<OnboardingCommandCopyButtonProps>): JSX.Element {
  return (
    <Button
      className="shrink-0 border-white/25 bg-transparent text-white/90 hover:bg-white/10 hover:text-white"
      onClick={onCopy}
      size="xs"
      type="button"
      variant="outline"
    >
      {status === 'copied' ? (
        <Check aria-hidden="true" className="size-3" strokeWidth={2.25} />
      ) : (
        <Copy aria-hidden="true" className="size-3" strokeWidth={2.25} />
      )}
      {readCommandCopyLabel(status)}
    </Button>
  );
}

function readCommandCopyLabel(status: OnboardingCommandCopyStatus): string {
  switch (status) {
    case 'copied':
      return 'Copied';
    case 'failed':
      return 'Copy failed';
    case 'idle':
      return 'Copy';
  }
}

function updateCopyStatus(
  setCopyStatus: (status: OnboardingCommandCopyStatus) => void,
  status: 'copied' | 'failed',
): void {
  setCopyStatus(status);
  window.setTimeout((): void => {
    setCopyStatus('idle');
  }, 1800);
}

async function copyTextToClipboard(text: string, source: HTMLElement | null): Promise<void> {
  if (copyTextFromSource(source)) {
    return;
  }

  const clipboard: Clipboard | undefined = readClipboardApi();
  if (clipboard === undefined) {
    throw new Error('Copy command failed.');
  }

  await clipboard.writeText(text);
}

function readClipboardApi(): Clipboard | undefined {
  const browserNavigator: Partial<Pick<Navigator, 'clipboard'>> = navigator;
  return browserNavigator.clipboard;
}

function copyTextFromSource(source: HTMLElement | null): boolean {
  if (source === null) {
    return false;
  }
  const activeElement: Element | null = document.activeElement;
  const selection: Selection | null = window.getSelection();
  const range: Range = document.createRange();
  range.selectNodeContents(source);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand('copy');
  } finally {
    selection?.removeAllRanges();
    restoreFocus(activeElement);
  }
}

function restoreFocus(activeElement: Element | null): void {
  if (activeElement instanceof HTMLElement) {
    activeElement.focus({ preventScroll: true });
  }
}

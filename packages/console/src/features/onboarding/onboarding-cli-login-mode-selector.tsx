import type { JSX } from 'react';
import { cn } from '../../lib/utils';

export type CliLoginMode = 'install' | 'installed';

export interface CliLoginHeaderCopy {
  description: string;
  title: string;
}

interface CliLoginModeSelectorProps {
  mode: CliLoginMode;
  onSelect: (mode: CliLoginMode) => void;
}

interface CliLoginModeButtonProps extends CliLoginModeSelectorProps {
  label: string;
  value: CliLoginMode;
}

export function CliLoginModeSelector({ mode, onSelect }: Readonly<CliLoginModeSelectorProps>): JSX.Element {
  return (
    <div className="grid gap-2">
      <p className="text-[12px] font-medium uppercase text-[#485259]">This machine</p>
      <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-black/10 bg-[#f5f6f7] p-1">
        <CliLoginModeButton label="Need to install CLI" mode={mode} onSelect={onSelect} value="install" />
        <CliLoginModeButton label="CLI already installed" mode={mode} onSelect={onSelect} value="installed" />
      </div>
    </div>
  );
}

export function readCliLoginHeaderCopy(mode: CliLoginMode): CliLoginHeaderCopy {
  if (mode === 'installed') {
    return {
      description: 'Use the installed CLI to finish the session-bound login for this project.',
      title: 'Log in with CLI',
    };
  }

  return {
    description: 'Install the local CLI, then finish the session-bound login for this runtime.',
    title: 'Install and log in with CLI',
  };
}

function CliLoginModeButton({ label, mode, onSelect, value }: Readonly<CliLoginModeButtonProps>): JSX.Element {
  const isSelected: boolean = mode === value;

  return (
    <button
      className={cn(
        'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3480c8]/50',
        isSelected ? 'bg-white text-[#111212] shadow-sm' : 'text-[#485259] hover:text-[#111212]',
      )}
      onClick={(): void => {
        onSelect(value);
      }}
      type="button"
    >
      {label}
    </button>
  );
}

import type { JSX } from 'react';
import { GitBranch, Terminal, type LucideIcon } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import type { OnboardingDeployMethod } from './onboarding-page.types';

interface OnboardingMethodSelectorProps {
  method: OnboardingDeployMethod | undefined;
  onSelect: (method: OnboardingDeployMethod) => void;
}

interface OnboardingMethodButtonProps {
  isSelected: boolean;
  option: OnboardingMethodOption;
  onSelect: (method: OnboardingDeployMethod) => void;
}

interface OnboardingMethodIconProps {
  icon: LucideIcon;
}

interface OnboardingMethodCopyProps {
  option: OnboardingMethodOption;
}

interface OnboardingMethodOption {
  description: string;
  icon: LucideIcon;
  method: OnboardingDeployMethod;
  title: string;
}

const onboardingMethodOptions: OnboardingMethodOption[] = [
  {
    description: 'Connect GitHub, pick a repository, then deploy from pushes.',
    icon: GitBranch,
    method: 'git',
    title: 'Git',
  },
  {
    description: 'Deploy the current checkout with local CLI commands.',
    icon: Terminal,
    method: 'cli',
    title: 'CLI',
  },
];

export function OnboardingMethodSelector({ method, onSelect }: Readonly<OnboardingMethodSelectorProps>): JSX.Element {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-2">
      {onboardingMethodOptions.map(
        (option: OnboardingMethodOption): JSX.Element => (
          <OnboardingMethodButton
            isSelected={method === option.method}
            key={option.method}
            onSelect={onSelect}
            option={option}
          />
        ),
      )}
    </div>
  );
}

function OnboardingMethodButton({ isSelected, onSelect, option }: Readonly<OnboardingMethodButtonProps>): JSX.Element {
  return (
    <button
      className={readMethodButtonClassName(isSelected)}
      onClick={(): void => {
        onSelect(option.method);
      }}
      type="button"
    >
      <OnboardingMethodIcon icon={option.icon} />
      <OnboardingMethodCopy option={option} />
    </button>
  );
}

function OnboardingMethodIcon({ icon: Icon }: Readonly<OnboardingMethodIconProps>): JSX.Element {
  return (
    <span className="flex size-10 items-center justify-center rounded-md border border-black/10 bg-black/[0.03] text-[#485259]">
      <Icon aria-hidden="true" size={18} />
    </span>
  );
}

function OnboardingMethodCopy({ option }: Readonly<OnboardingMethodCopyProps>): JSX.Element {
  return (
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold leading-5 text-[#111212]">{option.title}</span>
      <span className="mt-1 block text-[13px] leading-5 text-[#485259]">{option.description}</span>
    </span>
  );
}

function readMethodButtonClassName(isSelected: boolean): string {
  return cn(
    'grid min-h-[96px] grid-cols-[40px_1fr] gap-3 rounded-lg border bg-white p-4 text-left transition-colors hover:border-[#3480c8]/60 hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3480c8]/50',
    isSelected ? 'border-[#3480c8] bg-[#f4f9ff]' : 'border-black/10',
  );
}

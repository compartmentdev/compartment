import type { JSX } from 'react';
import { Check } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import type { OnboardingProcessStep, OnboardingProcessStepHrefReader } from './onboarding-page.types';

interface OnboardingProcessStepDefinition {
  step: OnboardingProcessStep;
  title: string;
}

interface OnboardingProcessStepperProps {
  currentStep: OnboardingProcessStep;
  isComplete: boolean;
  readStepHref: OnboardingProcessStepHrefReader;
}

interface OnboardingProcessStepItemProps {
  currentIndex: number;
  href: string | undefined;
  index: number;
  isComplete: boolean;
  step: OnboardingProcessStepDefinition;
}

interface OnboardingProcessStepContentProps {
  isActive: boolean;
  isDone: boolean;
  step: OnboardingProcessStepDefinition;
  stepNumber: string;
}

const onboardingProcessSteps: OnboardingProcessStepDefinition[] = [
  { step: 'choose', title: 'Choose type' },
  { step: 'prepare', title: 'Connect source' },
  { step: 'verify', title: 'Set up app' },
  { step: 'deploy', title: 'Wait for deploy' },
];

export function OnboardingProcessStepper({
  currentStep,
  isComplete,
  readStepHref,
}: Readonly<OnboardingProcessStepperProps>): JSX.Element {
  const currentIndex: number = readCurrentStepIndex(currentStep);

  return (
    <ol className="mx-auto grid w-full max-w-5xl gap-2 sm:grid-cols-4">
      {onboardingProcessSteps.map(
        (step: OnboardingProcessStepDefinition, index: number): JSX.Element => (
          <OnboardingProcessStepItem
            currentIndex={currentIndex}
            href={index <= currentIndex ? readStepHref(step.step) : undefined}
            index={index}
            isComplete={isComplete}
            key={step.step}
            step={step}
          />
        ),
      )}
    </ol>
  );
}

function OnboardingProcessStepItem({
  currentIndex,
  href,
  index,
  isComplete,
  step,
}: Readonly<OnboardingProcessStepItemProps>): JSX.Element {
  const isDone: boolean = index < currentIndex || (isComplete && index === currentIndex);
  const isActive: boolean = index === currentIndex && !isDone;
  const content: JSX.Element = (
    <OnboardingProcessStepContent isActive={isActive} isDone={isDone} step={step} stepNumber={(index + 1).toString()} />
  );

  return (
    <li>
      {href === undefined ? (
        <span className={readStepItemClassName(isActive, isDone)}>{content}</span>
      ) : (
        <a className={readStepItemClassName(isActive, isDone)} href={href}>
          {content}
        </a>
      )}
    </li>
  );
}

function OnboardingProcessStepContent({
  isActive,
  isDone,
  step,
  stepNumber,
}: Readonly<OnboardingProcessStepContentProps>): JSX.Element {
  return (
    <>
      <span className={readStepMarkerClassName(isActive, isDone)}>
        {isDone ? <Check aria-hidden="true" size={14} /> : stepNumber}
      </span>
      <span className="min-w-0 text-[13px] font-medium leading-5">{step.title}</span>
    </>
  );
}

function readCurrentStepIndex(currentStep: OnboardingProcessStep): number {
  return onboardingProcessSteps.findIndex(
    (step: OnboardingProcessStepDefinition): boolean => step.step === currentStep,
  );
}

function readStepItemClassName(isActive: boolean, isDone: boolean): string {
  return cn(
    'grid min-h-11 grid-cols-[28px_1fr] items-center gap-2 rounded-card border px-3 py-2 text-[#485259] no-underline',
    isActive ? 'border-[#3480c8] bg-card text-[#111212]' : '',
    !isActive && isDone ? 'border-[#cfe9d7] bg-[#eef8f1] text-[#1f6b35]' : '',
    !isActive && !isDone ? 'border-black/10 bg-card/70' : '',
  );
}

function readStepMarkerClassName(isActive: boolean, isDone: boolean): string {
  return cn(
    'flex size-7 items-center justify-center rounded-icon text-[12px] font-semibold',
    isDone ? 'bg-[#2f7d32] text-white' : '',
    isActive ? 'bg-[#111212] text-white' : '',
    isActive || isDone ? '' : 'border border-black/10 bg-card text-[#485259]',
  );
}

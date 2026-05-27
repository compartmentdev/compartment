import {
  type AccessAssignmentScopeProjectOption,
  type AccessAssignmentScopeType,
} from '@compartment/contracts/browser';
import type { JSX, ReactNode } from 'react';
import { MultiComboBox, type MultiComboBoxOption } from '../../components/multi-combo-box';
import { cn } from '../../lib/utils';
import { accessDrawerPrimaryActionButtonClassName } from './access-ui';
import {
  type AccessScopeEnvironmentOption,
  readScopeEnvironmentOptions,
  readScopeProjectNames,
  readValidScopeEnvironmentValues,
} from './access-scope-options';

interface AccessScopeInputsProps {
  environmentValues: string[];
  projectNames: string[];
  scopeProjects: AccessAssignmentScopeProjectOption[];
  scopeType: AccessAssignmentScopeType;
  setEnvironmentValues: (values: string[]) => void;
  setProjectNames: (values: string[]) => void;
}

interface InheritedScopeFieldProps {
  children: ReactNode;
  className?: string | undefined;
}

const accessAssignmentInheritedFieldClassName: string = 'md:pl-10';

export const accessAssignmentPrimaryRowClassName: string =
  'grid w-full gap-2 md:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_auto] md:items-center';
const accessAssignmentSecondaryRowClassName: string = 'grid gap-2 md:col-span-4 md:[grid-template-columns:subgrid]';
export const accessAssignmentSubmitButtonClassName: string = cn(
  accessDrawerPrimaryActionButtonClassName,
  'w-fit justify-self-start',
);

export function AccessScopeInputs(props: Readonly<AccessScopeInputsProps>): JSX.Element | null {
  if (props.scopeType === 'organization') {
    return null;
  }

  return (
    <div className={accessAssignmentSecondaryRowClassName}>
      <ProjectScopeSelect props={props} />
      <EnvironmentScopeSelect props={props} />
    </div>
  );
}

export function isAccessScopeSelectionReady(
  scopeType: AccessAssignmentScopeType,
  projectNames: string[],
  environmentValues: string[],
): boolean {
  if (scopeType === 'organization') {
    return true;
  }
  if (projectNames.length === 0) {
    return false;
  }

  return scopeType !== 'environment' || environmentValues.length > 0;
}

function ProjectScopeSelect({ props }: Readonly<{ props: AccessScopeInputsProps }>): JSX.Element {
  return (
    <InheritedScopeField className="md:col-start-1">
      <MultiComboBox
        className="w-full"
        emptyMessage="No matching projects."
        onChange={createProjectChangeHandler(props)}
        options={readProjectOptions(props.scopeProjects)}
        placeholder="Select project"
        searchPlaceholder="Search projects"
        values={props.projectNames}
      />
    </InheritedScopeField>
  );
}

function EnvironmentScopeSelect({ props }: Readonly<{ props: AccessScopeInputsProps }>): JSX.Element | null {
  if (props.scopeType !== 'environment') {
    return null;
  }

  return (
    <InheritedScopeField className="md:col-start-3">
      <MultiComboBox
        className="w-full"
        disabled={props.projectNames.length === 0}
        emptyMessage={props.projectNames.length === 0 ? 'Select a project first.' : 'No matching environments.'}
        onChange={props.setEnvironmentValues}
        options={readEnvironmentOptions(props.scopeProjects, props.projectNames)}
        placeholder={props.projectNames.length === 0 ? 'Select project first' : 'Select environment'}
        searchPlaceholder="Search environments"
        values={props.environmentValues}
      />
    </InheritedScopeField>
  );
}

function InheritedScopeField({ children, className }: Readonly<InheritedScopeFieldProps>): JSX.Element {
  return (
    <div className={cn('relative w-full', accessAssignmentInheritedFieldClassName, className)}>
      <div
        className="pointer-events-none absolute left-0 top-[-8px] hidden h-[27px] w-10 rounded-bl-[10px] border-b border-l border-[var(--cpt-border-default,rgba(0,0,0,0.08))] md:block"
        data-access-inherited-connector
      />
      {children}
    </div>
  );
}

function createProjectChangeHandler(props: Readonly<AccessScopeInputsProps>): (projectNames: string[]) => void {
  return (projectNames: string[]): void => {
    props.setProjectNames(projectNames);
    props.setEnvironmentValues(
      readValidScopeEnvironmentValues(props.scopeProjects, projectNames, props.environmentValues),
    );
  };
}

function readProjectOptions(scopeProjects: AccessAssignmentScopeProjectOption[]): MultiComboBoxOption[] {
  return readScopeProjectNames(scopeProjects).map(
    (projectName: string): MultiComboBoxOption => ({
      label: projectName,
      value: projectName,
    }),
  );
}

function readEnvironmentOptions(
  scopeProjects: AccessAssignmentScopeProjectOption[],
  projectNames: string[],
): MultiComboBoxOption[] {
  return readScopeEnvironmentOptions(scopeProjects, projectNames).map(
    (option: AccessScopeEnvironmentOption): MultiComboBoxOption => ({
      label: option.label,
      searchText: option.label,
      value: option.value,
    }),
  );
}

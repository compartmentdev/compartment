import {
  type AccessAssignmentScopeProjectOption,
  type AccessAssignmentScopeType,
} from '@compartment/contracts/browser';
import { type JSX, type ReactNode, useId } from 'react';
import { MultiComboBox, type MultiComboBoxOption } from '../../components/multi-combo-box';
import { Button } from '../../components/ui/button';
import { Plus } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { accessDrawerPrimaryAddButtonClassName } from './access-ui';
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

interface DependentScopeFieldProps {
  children: ReactNode;
  className?: string | undefined;
  depth: 1 | 2;
  label: string;
  labelId: string;
}

interface AccessAssignmentSubmitButtonProps {
  disabled: boolean;
  isPending: boolean;
}

const accessAssignmentScopeBranchClassName: string = 'grid w-full gap-2 md:min-w-0 md:w-[min(34rem,80%)]';
const accessAssignmentScopeFieldLabelClassName: string =
  'px-1 text-[12px] font-medium leading-4 text-[var(--cpt-text-secondary,#485259)]';

export const accessAssignmentPrimaryRowClassName: string =
  'grid w-full gap-2 md:grid-cols-[minmax(0,1.4fr)_16px_minmax(0,1fr)_auto] md:items-center';
export const accessAssignmentConnectorClassName: string =
  'hidden self-center items-center justify-center text-[14px] leading-none text-muted-foreground md:flex';
const accessAssignmentSubmitButtonClassName: string = cn(
  accessDrawerPrimaryAddButtonClassName,
  'w-fit justify-self-start',
);

export function AccessAssignmentSubmitButton({
  disabled,
  isPending,
}: Readonly<AccessAssignmentSubmitButtonProps>): JSX.Element {
  return (
    <Button
      className={accessAssignmentSubmitButtonClassName}
      disabled={disabled}
      size="sm"
      type="submit"
      variant="default"
    >
      {isPending ? null : <Plus className="size-4" />}
      {isPending ? 'Adding...' : 'Add assignment'}
    </Button>
  );
}

export function AccessScopeInputs(props: Readonly<AccessScopeInputsProps>): JSX.Element | null {
  if (props.scopeType === 'organization') {
    return null;
  }

  return (
    <div className={accessAssignmentScopeBranchClassName}>
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
  const labelId: string = useId();

  return (
    <DependentScopeField depth={1} label="Project(s)" labelId={labelId}>
      <MultiComboBox
        className="min-w-0 w-full"
        emptyMessage="No matching projects."
        labelId={labelId}
        onChange={createProjectChangeHandler(props)}
        options={readProjectOptions(props.scopeProjects)}
        placeholder="Select project(s)"
        searchPlaceholder="Search projects"
        values={props.projectNames}
      />
    </DependentScopeField>
  );
}

function EnvironmentScopeSelect({ props }: Readonly<{ props: AccessScopeInputsProps }>): JSX.Element | null {
  const labelId: string = useId();

  if (props.scopeType !== 'environment') {
    return null;
  }

  return (
    <DependentScopeField depth={2} label="Environment(s)" labelId={labelId}>
      <MultiComboBox
        className="min-w-0 w-full"
        disabled={props.projectNames.length === 0}
        emptyMessage={props.projectNames.length === 0 ? 'Select project(s) first.' : 'No matching environments.'}
        labelId={labelId}
        onChange={props.setEnvironmentValues}
        options={readEnvironmentOptions(props.scopeProjects, props.projectNames)}
        placeholder={props.projectNames.length === 0 ? 'Select project(s) first' : 'Select environment(s)'}
        searchPlaceholder="Search environments"
        values={props.environmentValues}
      />
    </DependentScopeField>
  );
}

function DependentScopeField({
  children,
  className,
  depth,
  label,
  labelId,
}: Readonly<DependentScopeFieldProps>): JSX.Element {
  return (
    <div className={cn('relative min-w-0 w-full space-y-1', readDependentScopeFieldPaddingClassName(depth), className)}>
      <div
        className={cn(
          'pointer-events-none absolute top-[-8px] hidden h-[27px] w-8 rounded-bl-field border-b border-l border-[var(--cpt-border-default,rgba(0,0,0,0.08))] md:block',
          readDependentScopeConnectorClassName(depth),
        )}
        data-access-inherited-connector
      />
      <p className={accessAssignmentScopeFieldLabelClassName} id={labelId}>
        {label}
      </p>
      {children}
    </div>
  );
}

function readDependentScopeConnectorClassName(depth: 1 | 2): string {
  return depth === 1 ? 'left-0' : 'left-8';
}

function readDependentScopeFieldPaddingClassName(depth: 1 | 2): string {
  return depth === 1 ? 'md:pl-8' : 'md:pl-16';
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

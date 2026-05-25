import {
  type AccessAssignmentScopeProjectOption,
  type AccessAssignmentScopeType,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { MultiComboBox, type MultiComboBoxOption } from '../../components/multi-combo-box';
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

export const accessAssignmentPrimaryRowClassName: string =
  'grid gap-2 md:grid-cols-[minmax(0,270px)_14px_minmax(0,219px)_160px] md:items-center md:gap-[14px]';
const accessAssignmentSecondaryRowClassName: string =
  'grid gap-2 md:col-span-4 md:grid-cols-[minmax(0,270px)_14px_minmax(0,219px)_160px] md:gap-[14px]';
export const accessAssignmentSubmitButtonClassName: string = 'h-7 w-[160px] justify-center px-3';

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
    <MultiComboBox
      className="w-full md:col-start-1"
      emptyMessage="No matching projects."
      onChange={createProjectChangeHandler(props)}
      options={readProjectOptions(props.scopeProjects)}
      placeholder="Select project"
      searchPlaceholder="Search projects"
      values={props.projectNames}
    />
  );
}

function EnvironmentScopeSelect({ props }: Readonly<{ props: AccessScopeInputsProps }>): JSX.Element | null {
  if (props.scopeType !== 'environment') {
    return null;
  }

  return (
    <MultiComboBox
      className="w-full md:col-start-3"
      disabled={props.projectNames.length === 0}
      emptyMessage={props.projectNames.length === 0 ? 'Select a project first.' : 'No matching environments.'}
      onChange={props.setEnvironmentValues}
      options={readEnvironmentOptions(props.scopeProjects, props.projectNames)}
      placeholder={props.projectNames.length === 0 ? 'Select project first' : 'Select environment'}
      searchPlaceholder="Search environments"
      values={props.environmentValues}
    />
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

// @vitest-environment jsdom

import * as React from 'react';
import { act, useState, type ReactElement } from 'react';
import type {
  AccessAssignmentSummary,
  AccessGroupListRow,
  AccessRoleListRow,
  PermissionKey,
} from '@compartment/contracts/browser';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { NavigateFunction } from 'react-router';
import { GroupDrawerHeader, GroupSummaryCard } from '../src/features/groups/groups-page.detail-layout';
import { type GroupsPageState, useGroupsPageState } from '../src/features/groups/groups-page.state';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type { BrowserOrganizationOption } from '../src/services/browser-organization.service.types';

interface MountedGroupsEditorProbe {
  container: HTMLDivElement;
  rerender: (data: BrowserGroupsPageResult) => Promise<void>;
  unmount: () => Promise<void>;
}

type EditableFieldPrototype = HTMLInputElement | HTMLTextAreaElement;

configureReactActEnvironment();

class MountedGroupsEditorProbeValue implements MountedGroupsEditorProbe {
  public readonly container: HTMLDivElement;
  private readonly renderProbe: (data: BrowserGroupsPageResult) => Promise<void>;
  private readonly root: Root;

  public constructor(
    container: HTMLDivElement,
    root: Root,
    renderProbe: (data: BrowserGroupsPageResult) => Promise<void>,
  ) {
    this.container = container;
    this.renderProbe = renderProbe;
    this.root = root;
  }

  public async rerender(data: BrowserGroupsPageResult): Promise<void> {
    await this.renderProbe(data);
  }

  public async unmount(): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.unmount();
      await flushEffects();
    });
    this.container.remove();
  }
}

afterEach((): void => {
  document.body.innerHTML = '';
});

describe('group detail edit draft state', (): void => {
  it('does not render removed summary metric tiles', async (): Promise<void> => {
    const mountedProbe: MountedGroupsEditorProbe = await mountGroupsEditorProbe(
      createGroupsPageResult('Operators who handle incidents'),
    );

    try {
      expect(mountedProbe.container.textContent).not.toContain('users');
      expect(mountedProbe.container.textContent).not.toContain('assignments');
      expect(mountedProbe.container.textContent).not.toContain('projects');
    } finally {
      await mountedProbe.unmount();
    }
  });

  it('keeps in-progress group edits across page data rerenders', async (): Promise<void> => {
    const mountedProbe: MountedGroupsEditorProbe = await mountGroupsEditorProbe(
      createGroupsPageResult('Operators who handle incidents'),
    );

    try {
      await clickButton(mountedProbe.container, 'Edit group');
      await updateFieldValue(requireNameInput(mountedProbe.container), 'Operators Plus');
      await updateFieldValue(requireDescriptionField(mountedProbe.container), 'Draft description');

      expect(requireNameInput(mountedProbe.container).value).toBe('Operators Plus');
      expect(requireDescriptionField(mountedProbe.container).value).toBe('Draft description');

      await mountedProbe.rerender(createGroupsPageResult('Operators who handle incidents'));

      expect(requireNameInput(mountedProbe.container).value).toBe('Operators Plus');
      expect(requireDescriptionField(mountedProbe.container).value).toBe('Draft description');
    } finally {
      await mountedProbe.unmount();
    }
  });

  it('resets drafts back to persisted values when header cancel edit closes the form', async (): Promise<void> => {
    const mountedProbe: MountedGroupsEditorProbe = await mountGroupsEditorProbe(createGroupsPageResult(null));

    try {
      await clickButton(mountedProbe.container, 'Edit group');
      await updateFieldValue(requireNameInput(mountedProbe.container), 'Operators Plus');
      await updateFieldValue(requireDescriptionField(mountedProbe.container), 'Draft description');

      await clickButton(mountedProbe.container, 'Cancel edit');
      await clickButton(mountedProbe.container, 'Edit group');

      expect(requireNameInput(mountedProbe.container).value).toBe('Operators');
      expect(requireDescriptionField(mountedProbe.container).value).toBe('');
    } finally {
      await mountedProbe.unmount();
    }
  });
});

function GroupsEditorProbe({ data }: Readonly<{ data: BrowserGroupsPageResult }>): ReactElement {
  const navigate: NavigateFunction = (): void => undefined;
  const state: GroupsPageState = useGroupsPageState(data, navigate);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(GroupDrawerHeader, { isEditing, setIsEditing, state }),
    React.createElement(GroupSummaryCard, { isEditing, setIsEditing, state }),
  );
}

async function mountGroupsEditorProbe(data: BrowserGroupsPageResult): Promise<MountedGroupsEditorProbe> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  const renderProbe: (nextData: BrowserGroupsPageResult) => Promise<void> = async (
    nextData: BrowserGroupsPageResult,
  ): Promise<void> => {
    await act(async (): Promise<void> => {
      root.render(React.createElement(GroupsEditorProbe, { data: nextData }));
      await flushEffects();
    });
  };

  await renderProbe(data);

  return new MountedGroupsEditorProbeValue(container, root, renderProbe);
}

function createGroupsPageResult(description: string | null): BrowserGroupsPageResult {
  const selectedGroup: AccessGroupListRow = {
    assignedRoleNames: ['Viewer'],
    assignmentCount: 1,
    assignmentScopeLabels: ['Organization'],
    description,
    id: 'group_123',
    memberCount: 2,
    name: 'Operators',
  };

  return {
    assignments: [
      {
        createdAt: '2025-01-01T00:00:00.000Z',
        id: 'asg_123',
        roleId: 'role_123',
        roleKind: 'custom',
        roleName: 'Viewer',
        scope: { projectName: 'billing', scopeType: 'project' },
        subject: {
          groupId: selectedGroup.id,
          groupName: selectedGroup.name,
          subjectType: 'group',
        },
      },
    ] satisfies AccessAssignmentSummary[],
    currentOrganizationPermissions: createGroupManagerPermissions(),
    groups: [selectedGroup],
    members: [],
    mode: 'detail',
    noticeMessage: undefined,
    organizationContext: { kind: 'selected', selectedOrganizationSlug: 'acme-dev' },
    organizations: [createOrganizationOption()],
    principalEmail: 'admin@example.com',
    roles: [] satisfies AccessRoleListRow[],
    scopeProjects: [],
    selectedGroupId: selectedGroup.id,
    selectedOrganizationSlug: 'acme-dev',
    showOrganizationSelector: false,
  };
}

function createGroupManagerPermissions(): PermissionKey[] {
  return ['organization.group.read', 'organization.group.manage', 'organization.role.read'];
}

function createOrganizationOption(): BrowserOrganizationOption {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button: HTMLButtonElement = requireButton(container, label);

  await act(async (): Promise<void> => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushEffects();
  });
}

async function updateFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    writeFieldValue(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await flushEffects();
  });
}

function requireButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button: HTMLButtonElement | undefined = [...container.querySelectorAll('button')].find(
    (candidate: HTMLButtonElement): boolean => candidate.textContent.includes(label),
  );
  if (button === undefined) {
    throw new Error(`Expected button with label ${label}.`);
  }

  return button;
}

function requireNameInput(container: HTMLElement): HTMLInputElement {
  const input: HTMLInputElement | null = container.querySelector('input');
  if (input === null) {
    throw new Error('Expected group name input.');
  }

  return input;
}

function requireDescriptionField(container: HTMLElement): HTMLTextAreaElement {
  const textarea: HTMLTextAreaElement | null = container.querySelector('textarea');
  if (textarea === null) {
    throw new Error('Expected group description textarea.');
  }

  return textarea;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

function writeFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype: EditableFieldPrototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor: TypedPropertyDescriptor<string> | undefined = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set === undefined) {
    throw new Error('Expected value setter for editable field.');
  }

  descriptor.set.call(element, value);
}

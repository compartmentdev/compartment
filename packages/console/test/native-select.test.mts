// @vitest-environment jsdom

import * as React from 'react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeSelect } from '../src/components/ui/native-select';

interface MountedNativeSelectTestApp {
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}

class MountedNativeSelectTestAppValue implements MountedNativeSelectTestApp {
  public constructor(
    public readonly container: HTMLDivElement,
    private readonly root: Root,
  ) {}

  public async unmount(): Promise<void> {
    await act(async (): Promise<void> => {
      this.root.unmount();
      await flushEffects();
    });
    this.container.remove();
  }
}

configureReactActEnvironment();

afterEach((): void => {
  document.body.innerHTML = '';
});

describe('native select accessibility', (): void => {
  it('derives combobox labelling from a wrapping label when no aria-label is provided', async (): Promise<void> => {
    const mountedApp: MountedNativeSelectTestApp = await mountNativeSelectTestApp(
      React.createElement(
        'label',
        { className: 'grid gap-2' },
        React.createElement('span', null, 'Event'),
        React.createElement(
          NativeSelect,
          { defaultValue: '', name: 'eventType' },
          React.createElement('option', { value: '' }, 'All events'),
          React.createElement('option', { value: 'organization.user.invited' }, 'organization.user.invited'),
        ),
      ),
    );

    try {
      const label: HTMLLabelElement = requireLabel(mountedApp.container);
      const combobox: HTMLButtonElement = requireCombobox(mountedApp.container);

      expect(label.id).not.toBe('');
      expect(combobox.getAttribute('aria-labelledby')).toBe(label.id);
      expect(combobox.getAttribute('aria-label')).toBeNull();
    } finally {
      await mountedApp.unmount();
    }
  });

  it('preserves an explicit aria-label without adding derived label references', async (): Promise<void> => {
    const mountedApp: MountedNativeSelectTestApp = await mountNativeSelectTestApp(
      React.createElement(
        NativeSelect,
        { 'aria-label': 'Rows per page', value: '20' },
        React.createElement('option', { value: '10' }, '10'),
        React.createElement('option', { value: '20' }, '20'),
      ),
    );

    try {
      const combobox: HTMLButtonElement = requireCombobox(mountedApp.container);

      expect(combobox.getAttribute('aria-label')).toBe('Rows per page');
      expect(combobox.hasAttribute('aria-labelledby')).toBe(false);
    } finally {
      await mountedApp.unmount();
    }
  });
});

async function mountNativeSelectTestApp(element: ReactElement): Promise<MountedNativeSelectTestApp> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  await act(async (): Promise<void> => {
    root.render(element);
    await flushEffects();
  });

  return new MountedNativeSelectTestAppValue(container, root);
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function requireLabel(container: HTMLElement): HTMLLabelElement {
  const label: HTMLLabelElement | null = container.querySelector('label');
  if (label === null) {
    throw new Error('Expected wrapping label.');
  }

  return label;
}

function requireCombobox(container: HTMLElement): HTMLButtonElement {
  const button: HTMLButtonElement | null = container.querySelector('button[role="combobox"]');
  if (button === null) {
    throw new Error('Expected combobox trigger.');
  }

  return button;
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

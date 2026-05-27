// @vitest-environment jsdom

import * as React from 'react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserSoftNavigateHandler } from '../src/browser-soft-navigation';
import { AccessDrawerShell } from '../src/features/access/access-ui';

type NavigateMock = Mock<BrowserSoftNavigateHandler>;

interface MountedAccessDrawerShell {
  container: HTMLDivElement;
  navigate: NavigateMock;
  unmount: () => Promise<void>;
}

class MountedAccessDrawerShellValue implements MountedAccessDrawerShell {
  public constructor(
    public readonly container: HTMLDivElement,
    public readonly navigate: NavigateMock,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('access drawer shell keyboard support', (): void => {
  it('closes the drawer when Escape is pressed', async (): Promise<void> => {
    vi.useFakeTimers();
    const mountedShell: MountedAccessDrawerShell = await mountAccessDrawerShell();

    try {
      await act(async (): Promise<void> => {
        window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        await flushEffects();
      });

      expect(mountedShell.navigate).not.toHaveBeenCalled();

      await act(async (): Promise<void> => {
        vi.advanceTimersByTime(200);
        await flushEffects();
      });

      expect(mountedShell.navigate).toHaveBeenCalledWith('/orgs/acme-dev/users');
    } finally {
      await mountedShell.unmount();
    }
  });
});

async function mountAccessDrawerShell(): Promise<MountedAccessDrawerShell> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  const navigate: NavigateMock = vi.fn<BrowserSoftNavigateHandler>();
  document.body.append(container);

  await act(async (): Promise<void> => {
    root.render(createAccessDrawerShellElement(navigate));
    await flushEffects();
  });

  return new MountedAccessDrawerShellValue(container, navigate, root);
}

function createAccessDrawerShellElement(onNavigate: BrowserSoftNavigateHandler): ReactElement {
  return React.createElement(AccessDrawerShell, {
    children: React.createElement('div', null, 'Drawer body'),
    closeHref: '/orgs/acme-dev/users',
    onNavigate,
    title: 'Invite user',
  });
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

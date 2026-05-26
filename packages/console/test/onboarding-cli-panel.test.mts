// @vitest-environment jsdom

import * as React from 'react';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserOnboardingPathname, browserProjectCreatePathname } from '../src/browser-public-paths';
import { CliOnboardingPanel } from '../src/features/onboarding/onboarding-cli-panel';

vi.mock(
  '../src/features/onboarding/onboarding-cli-status',
  (): {
    refreshCliLoginStatus: () => Promise<void>;
    useCliDeployStatusNavigation: () => void;
    useCliLoginStatusNavigation: () => void;
    useCliWaitingDeployStatus: () => { refresh: () => Promise<void>; response: null };
  } => ({
    refreshCliLoginStatus: async (): Promise<void> => {
      await Promise.resolve();
    },
    useCliDeployStatusNavigation: (): void => undefined,
    useCliLoginStatusNavigation: (): void => undefined,
    useCliWaitingDeployStatus: (): { refresh: () => Promise<void>; response: null } => ({
      refresh: async (): Promise<void> => {
        await Promise.resolve();
      },
      response: null,
    }),
  }),
);

interface MountedCliOnboardingPanel {
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}

class MountedCliOnboardingPanelValue implements MountedCliOnboardingPanel {
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

describe('CLI onboarding panel', (): void => {
  it('keeps direct onboarding on the install command without a mode selector', async (): Promise<void> => {
    const mountedPanel: MountedCliOnboardingPanel = await mountCliOnboardingPanel(
      createCliOnboardingPanelElement(browserOnboardingPathname),
    );

    try {
      expect(mountedPanel.container.textContent).toContain('Install and log in with CLI');
      expect(mountedPanel.container.textContent).not.toContain('CLI already installed');
      expect(readRenderedCommand(mountedPanel.container)).toContain('curl -fsSL https://compartment.dev/install.sh');
    } finally {
      await mountedPanel.unmount();
    }
  });

  it('defaults project creation to the install command while showing both mode choices', async (): Promise<void> => {
    const mountedPanel: MountedCliOnboardingPanel = await mountCliOnboardingPanel(
      createCliOnboardingPanelElement(browserProjectCreatePathname),
    );

    try {
      expect(mountedPanel.container.textContent).toContain('Need to install CLI');
      expect(mountedPanel.container.textContent).toContain('CLI already installed');
      expect(readRenderedCommand(mountedPanel.container)).toContain('curl -fsSL https://compartment.dev/install.sh');
    } finally {
      await mountedPanel.unmount();
    }
  });

  it('switches project creation to the login-only command for installed CLIs', async (): Promise<void> => {
    const mountedPanel: MountedCliOnboardingPanel = await mountCliOnboardingPanel(
      createCliOnboardingPanelElement(browserProjectCreatePathname),
    );

    try {
      await clickButton(mountedPanel.container, 'CLI already installed');

      expect(mountedPanel.container.textContent).toContain('Log in with CLI');
      expect(readRenderedCommand(mountedPanel.container)).toContain('compartment login --api-url');
      expect(readRenderedCommand(mountedPanel.container)).not.toContain(
        'curl -fsSL https://compartment.dev/install.sh',
      );
    } finally {
      await mountedPanel.unmount();
    }
  });
});

function createCliOnboardingPanelElement(flowPathname: string): ReactElement {
  return React.createElement(CliOnboardingPanel, {
    consoleOrigin: 'http://console.localhost:38080',
    flowPathname,
    onDeployCompleted: (): void => undefined,
    onDeployStarted: (): void => undefined,
    onLoginConfirmed: (): void => undefined,
    principalEmail: 'admin@example.com',
    selectedOrganizationSlug: 'acme-dev',
    sessionId: 'fdo_123',
    step: 'prepare',
  });
}

async function mountCliOnboardingPanel(element: ReactElement): Promise<MountedCliOnboardingPanel> {
  const container: HTMLDivElement = document.createElement('div');
  const root: Root = createRoot(container);
  document.body.append(container);

  await act(async (): Promise<void> => {
    root.render(element);
    await flushEffects();
  });

  return new MountedCliOnboardingPanelValue(container, root);
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button: HTMLButtonElement = requireButton(container, label);

  await act(async (): Promise<void> => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

function readRenderedCommand(container: HTMLElement): string {
  const command: HTMLPreElement | null = container.querySelector('pre[aria-label="Command to run"]');
  if (command === null) {
    throw new Error('Expected command block.');
  }

  return command.textContent;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function configureReactActEnvironment(): void {
  const globalState: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
  globalState.IS_REACT_ACT_ENVIRONMENT = true;
}

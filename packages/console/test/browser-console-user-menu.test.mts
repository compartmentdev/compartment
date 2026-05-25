import { compartmentCsrfCookieName, compartmentCsrfHeaderName } from '@compartment/contracts/browser';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BrowserConsoleUserBlock } from '../src/components/browser-console-user-menu';
import { createJsonResponse, waitForNextTick } from './browser-test.fixtures';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
interface InspectableProps {
  children?: ReactNode;
  onSelect?: (() => void) | undefined;
}

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('browser console user menu', (): void => {
  it('logs out and redirects to login', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(createJsonResponse({ success: true }));
    const assignMock: Mock<(href: string) => void> = vi.fn<(href: string) => void>();
    const onError: Mock<(message: string | undefined) => void> = vi.fn<(message: string | undefined) => void>();

    vi.stubGlobal('document', { cookie: `${compartmentCsrfCookieName}=csrf-token` });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        assign: assignMock,
      },
    });

    const onSelect: (() => void) | null = findSignOutAction(
      BrowserConsoleUserBlock({ onError, principalEmail: 'admin@example.com' }),
    );
    if (onSelect === null) {
      throw new Error('Expected sign out menu item.');
    }

    onSelect();
    await waitForNextTick();

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(compartmentCsrfHeaderName)).toBe('csrf-token');
    expect(onError).toHaveBeenCalledWith(undefined);
    expect(assignMock).toHaveBeenCalledWith('/login');
  });
});

function findSignOutAction(node: ReactNode): (() => void) | null {
  if (!isValidElement<InspectableProps>(node)) {
    return null;
  }

  if (hasSignOutSelect(node)) {
    return node.props.onSelect ?? null;
  }

  if (isBrowserConsoleElement(node)) {
    return findSignOutAction(node.type(node.props));
  }

  for (const child of Children.toArray(node.props.children)) {
    const action: (() => void) | null = findSignOutAction(child);
    if (action !== null) {
      return action;
    }
  }

  return null;
}

function hasSignOutSelect(node: ReactElement<InspectableProps>): node is ReactElement<Required<InspectableProps>> {
  const children: ReactNode[] = Children.toArray(node.props.children);
  return typeof node.props.onSelect === 'function' && children.length === 1 && children[0] === 'Sign out';
}

function isBrowserConsoleElement(
  node: ReactElement<InspectableProps>,
): node is ReactElement<InspectableProps> & { type: (props: InspectableProps) => ReactNode } {
  return typeof node.type === 'function' && String(node.type.name).startsWith('BrowserConsole');
}

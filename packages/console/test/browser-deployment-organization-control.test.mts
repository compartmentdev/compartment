import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DeploymentDetailsView } from '../src/features/deployment-history/deployment-details-view';
import { DeploymentHistoryView } from '../src/features/deployment-history/deployment-history-view';
import {
  createDeploymentDetailsPageResult,
  createDeploymentHistoryPageResult,
} from './browser-deployment-history.fixtures';

interface MockBrowserConsoleShellProps {
  children?: ReactNode;
  organizationControl?: ReactNode;
}

interface OrganizationControlElementProps {
  onChange: (organizationSlug: string) => void;
}

const capturedShellProps: MockBrowserConsoleShellProps[] = [];

vi.mock('../src/components/browser-console-header', async (): Promise<object> => {
  const react: { createElement: typeof createElement } = await import('react');

  function BrowserConsoleShell({ children, ...props }: Readonly<MockBrowserConsoleShellProps>): ReactElement {
    capturedShellProps.push(props);
    return react.createElement('div', {}, children);
  }

  return {
    BrowserConsoleShell,
    browserConsoleDetailBreadcrumbBarClassName: '',
    browserConsoleDetailPageHeaderClassName: '',
    browserConsolePageBodyClassName: '',
    browserConsolePageClassName: '',
    browserConsolePageGutterClassName: '',
  };
});

describe('browser deployment organization control', (): void => {
  afterEach((): void => {
    capturedShellProps.length = 0;
  });

  it('preserves scoped deployment history hrefs when switching organizations from history view', (): void => {
    const onNavigate: Mock<(href: string) => void> = vi.fn<(href: string) => void>();

    renderToStaticMarkup(
      createElement(DeploymentHistoryView, {
        data: createDeploymentHistoryPageResult({
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
          ],
          showOrganizationSelector: true,
        }),
        onNavigate,
      }),
    );

    readOrganizationControlElement().props.onChange('beta-dev');

    expect(onNavigate).toHaveBeenCalledWith('/orgs/beta-dev/projects/billing/deployments?environmentName=production');
  });

  it('preserves scoped deployment history hrefs when switching organizations from details view', (): void => {
    const onNavigate: Mock<(href: string) => void> = vi.fn<(href: string) => void>();

    renderToStaticMarkup(
      createElement(DeploymentDetailsView, {
        data: createDeploymentDetailsPageResult({
          organizations: [
            { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
            { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
          ],
          showOrganizationSelector: true,
        }),
        onNavigate,
      }),
    );

    readOrganizationControlElement().props.onChange('beta-dev');

    expect(onNavigate).toHaveBeenCalledWith('/orgs/beta-dev/projects/billing/deployments?environmentName=production');
  });
});

function readOrganizationControlElement(): ReactElement<OrganizationControlElementProps> {
  const organizationControl: ReactNode | undefined = capturedShellProps.at(-1)?.organizationControl;
  if (!isValidElement(organizationControl)) {
    throw new Error('Expected organization control element.');
  }

  return organizationControl as ReactElement<OrganizationControlElementProps>;
}

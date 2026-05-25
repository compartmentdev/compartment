import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserDeploymentDetailsPageResult } from '../src/services/browser-deployment-history.service.types';
import { BrowserRedirect } from '../src/lib/browser-redirect';
import {
  refreshDeploymentDetailsPageState,
  shouldRefreshDeploymentDetailsPage,
} from '../src/features/deployment-history/deployment-details-live-refresh.helpers';
import {
  createDeploymentDetailsPageResult,
  createDeploymentRunLogsResponse,
} from './browser-deployment-history.fixtures';

describe('deployment details live refresh helpers', (): void => {
  afterEach((): void => {
    vi.clearAllMocks();
  });

  it('polls deployment details for queued and running deployments only', (): void => {
    const runningResult: BrowserDeploymentDetailsPageResult = createDeploymentDetailsPageResult({
      deployment: {
        ...createDeploymentDetailsPageResult().deployment,
        status: 'running',
      },
    });
    const queuedResult: BrowserDeploymentDetailsPageResult = createDeploymentDetailsPageResult({
      deployment: {
        ...createDeploymentDetailsPageResult().deployment,
        status: 'queued',
      },
    });

    expect(shouldRefreshDeploymentDetailsPage(runningResult)).toBe(true);
    expect(shouldRefreshDeploymentDetailsPage(queuedResult)).toBe(true);
    expect(shouldRefreshDeploymentDetailsPage(createDeploymentDetailsPageResult())).toBe(false);
  });

  it('skips deployment details refresh when the browser location no longer matches the page data', async (): Promise<void> => {
    const refreshPageData: Mock<
      (data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>
    > = vi.fn<(data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>>();
    const setData: Mock<(data: BrowserDeploymentDetailsPageResult) => void> = vi.fn();
    const redirect: Mock<(error: Error) => boolean> = vi.fn();

    await expect(
      refreshDeploymentDetailsPageState({
        data: createDeploymentDetailsPageResult({
          deployment: {
            ...createDeploymentDetailsPageResult().deployment,
            status: 'running',
          },
        }),
        isCancelled: (): boolean => false,
        readLocationHref: (): string =>
          'http://console.localhost/orgs/acme-dev/projects/other/deployments/drn_999?environmentName=production',
        redirect,
        refreshPageData,
        setData,
      }),
    ).resolves.toBeUndefined();

    expect(refreshPageData).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('refreshes deployment details when the URL omits the environment query', async (): Promise<void> => {
    const refreshedData: BrowserDeploymentDetailsPageResult = createDeploymentDetailsPageResult({
      deployment: {
        ...createDeploymentDetailsPageResult().deployment,
        status: 'running',
      },
    });
    const refreshPageData: Mock<
      (data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>
    > = vi.fn<(data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>>(
      async (): Promise<BrowserDeploymentDetailsPageResult> => await Promise.resolve(refreshedData),
    );
    const setData: Mock<(data: BrowserDeploymentDetailsPageResult) => void> = vi.fn();

    await expect(
      refreshDeploymentDetailsPageState({
        data: createDeploymentDetailsPageResult({
          deployment: {
            ...createDeploymentDetailsPageResult().deployment,
            status: 'running',
          },
        }),
        isCancelled: (): boolean => false,
        readLocationHref: (): string => 'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123',
        refreshPageData,
        setData,
      }),
    ).resolves.toBeUndefined();

    expect(refreshPageData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledWith(refreshedData);
  });

  it('refreshes deployment details when the current run details URL still matches the page data', async (): Promise<void> => {
    const refreshedData: BrowserDeploymentDetailsPageResult = createDeploymentDetailsPageResult({
      deployment: {
        ...createDeploymentDetailsPageResult().deployment,
        status: 'running',
      },
      lines: [
        {
          ...createDeploymentRunLogsResponse().lines[0]!,
          message: 'new log line',
        },
      ],
    });
    const refreshPageData: Mock<
      (data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>
    > = vi.fn<(data: BrowserDeploymentDetailsPageResult) => Promise<BrowserDeploymentDetailsPageResult>>(
      async (): Promise<BrowserDeploymentDetailsPageResult> => await Promise.resolve(refreshedData),
    );
    const setData: Mock<(data: BrowserDeploymentDetailsPageResult) => void> = vi.fn();

    await expect(
      refreshDeploymentDetailsPageState({
        data: createDeploymentDetailsPageResult({
          deployment: {
            ...createDeploymentDetailsPageResult().deployment,
            status: 'running',
          },
        }),
        isCancelled: (): boolean => false,
        readLocationHref: (): string =>
          'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production',
        refreshPageData,
        setData,
      }),
    ).resolves.toBeUndefined();

    expect(refreshPageData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledWith(refreshedData);
  });

  it('ignores stale deployment details redirects after navigation changed', async (): Promise<void> => {
    let currentHref: string =
      'http://console.localhost/orgs/acme-dev/projects/billing/deployments/drn_123?environmentName=production';
    const redirect: Mock<(error: Error) => boolean> = vi.fn<(error: Error) => boolean>();
    const setData: Mock<(data: BrowserDeploymentDetailsPageResult) => void> = vi.fn();

    await expect(
      refreshDeploymentDetailsPageState({
        data: createDeploymentDetailsPageResult({
          deployment: {
            ...createDeploymentDetailsPageResult().deployment,
            status: 'running',
          },
        }),
        isCancelled: (): boolean => false,
        readLocationHref: (): string => currentHref,
        redirect,
        refreshPageData: async (): Promise<BrowserDeploymentDetailsPageResult> => {
          currentHref = 'http://console.localhost/orgs/acme-dev/projects/billing/deployments';
          await Promise.resolve();
          throw new BrowserRedirect('/orgs/acme-dev/projects/billing/deployments?error=deployment_details_unavailable');
        },
        setData,
      }),
    ).resolves.toBeUndefined();

    expect(redirect).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});

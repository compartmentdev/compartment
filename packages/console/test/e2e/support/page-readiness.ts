import { expect, type Locator } from '@playwright/test';

export type PageReadyState = 'content' | 'empty';

export async function waitForPageReadyState(
  contentLocator: Locator,
  emptyStateLocator: Locator,
): Promise<PageReadyState> {
  await expect(contentLocator.or(emptyStateLocator).first()).toBeVisible();

  if (await contentLocator.isVisible()) {
    return 'content';
  }

  await expect(emptyStateLocator).toBeVisible();
  return 'empty';
}

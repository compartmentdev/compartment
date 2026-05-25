import { type Locator, type Page } from '@playwright/test';

export function accessDetailDrawer(page: Page, visibleText: string): Locator {
  return page.locator('aside').filter({
    has: page.getByRole('button', { name: 'Close panel' }),
    hasText: visibleText,
  });
}

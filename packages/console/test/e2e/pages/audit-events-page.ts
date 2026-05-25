import { compartmentBrowserAuditPathname, type AuditEventType } from '@compartment/contracts/browser';
import { expect, type Locator, type Page } from '@playwright/test';
import { isConsolePathname } from '../support/console-paths';

export class AuditEventsPage {
  private readonly applyButton: Locator;
  private readonly auditLink: Locator;
  private readonly eventSelect: Locator;
  private readonly page: Page;
  private readonly primaryNavigation: Locator;
  private readonly table: Locator;

  constructor(page: Page) {
    this.applyButton = page.getByRole('button', { name: 'Apply' });
    this.auditLink = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Audit logs' });
    this.eventSelect = page.getByRole('combobox', { name: 'Event' });
    this.page = page;
    this.primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
    this.table = page.getByRole('table');
  }

  async openFromPrimaryNavigation(): Promise<void> {
    await expect(this.auditLink).toBeVisible();
    await Promise.all([
      this.page.waitForURL((url: URL): boolean => this.isAuditEventsUrl(url)),
      this.auditLink.click(),
    ]);
    await this.expectReady();
  }

  async expectReady(): Promise<void> {
    await expect(this.primaryNavigation.getByRole('link', { name: /Audit logs/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(this.eventSelect).toBeVisible();
    await expect(this.table).toBeVisible();
    await expect(this.table.getByRole('columnheader', { name: 'Event' })).toBeVisible();
    await expect(this.table.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(this.table.getByRole('columnheader', { name: 'Target' })).toBeVisible();
    await expect(this.table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  }

  async filterByEventType(eventType: AuditEventType): Promise<void> {
    await this.eventSelect.click();
    await this.page.getByRole('option', { exact: true, name: eventType }).click();
    await Promise.all([
      this.page.waitForURL(
        (url: URL): boolean => this.isAuditEventsUrl(url) && url.searchParams.get('eventType') === eventType,
      ),
      this.applyButton.click(),
    ]);
    await this.expectReady();
    await expect(this.eventSelect).toContainText(eventType);
  }

  async expectEventTargetVisible(targetText: string): Promise<void> {
    await expect(this.table.getByRole('cell', { name: targetText }).first()).toBeVisible();
  }

  async expectFilteredEventTarget(eventType: AuditEventType, targetText: string): Promise<void> {
    await this.filterByEventType(eventType);
    await this.expectEventTargetVisible(targetText);
  }

  private isAuditEventsUrl(url: URL): boolean {
    return isConsolePathname(url, compartmentBrowserAuditPathname);
  }
}

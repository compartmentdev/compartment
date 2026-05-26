import {
  compartmentBrowserHomePathname,
  compartmentBrowserProjectsPathname,
  buildCompartmentConsoleProjectOverviewPathname,
  buildCompartmentProjectOverviewApiPathname,
  compartmentProjectsApiPathname,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';

export class ProjectsPage {
  private readonly emptyProjectsMessage: Locator;
  private readonly page: Page;
  private readonly primaryNavigation: Locator;
  private readonly projectOverviewHeading: Locator;
  private readonly projectOverviewServicesTable: Locator;
  private readonly searchInput: Locator;

  constructor(page: Page) {
    this.emptyProjectsMessage = page.getByText('No projects found.');
    this.page = page;
    this.primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
    this.projectOverviewHeading = page.getByRole('heading', { name: 'Overview' });
    this.projectOverviewServicesTable = page.getByRole('table').filter({
      has: page.getByRole('columnheader', { exact: true, name: 'Service' }),
    });
    this.searchInput = page.getByRole('searchbox', { name: 'Search projects' });
  }

  async goto(): Promise<void> {
    await this.page.goto(compartmentBrowserHomePathname);
  }

  getReadyLocator(): Locator {
    return this.searchInput;
  }

  async expectReady(): Promise<void> {
    await expect(this.primaryNavigation.getByRole('link', { name: /Projects/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(this.searchInput).toBeVisible();
    await expect(this.page.getByRole('table')).toBeVisible();
  }

  async expectProjectVisible(projectName: string): Promise<void> {
    await expect(this.page.getByRole('cell', { exact: true, name: projectName })).toBeVisible();
  }

  async search(searchQuery: string): Promise<void> {
    await this.searchInput.fill(searchQuery);
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isProjectsSearchResponse(response, searchQuery)),
      this.page.waitForURL((url: URL): boolean => this.isProjectsSearchUrl(url, searchQuery)),
      this.searchInput.press('Enter'),
    ]);
  }

  async expectSearchQuery(searchQuery: string): Promise<void> {
    await expect(this.searchInput).toHaveValue(searchQuery);
    await expect(this.page).toHaveURL((url: URL): boolean => this.isProjectsSearchUrl(url, searchQuery));
  }

  async expectNoProjectsFound(): Promise<void> {
    await expect(this.emptyProjectsMessage).toBeVisible();
  }

  async openProjectOverview(projectName: string): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean => this.isProjectOverviewResponse(response, projectName)),
      this.page.waitForURL((url: URL): boolean => this.isProjectOverviewUrl(url, projectName)),
      this.projectRow(projectName).getByRole('link', { name: 'Details' }).click(),
    ]);
  }

  async expectProjectOverviewVisible(projectName: string): Promise<void> {
    await expect(this.page).toHaveURL((url: URL): boolean => this.isProjectOverviewUrl(url, projectName));
    await expect(this.primaryNavigation.getByRole('link', { name: /Projects/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(this.page.getByText(projectName, { exact: true })).toBeVisible();
    await expect(this.projectOverviewHeading).toBeVisible();
    await expect(this.projectOverviewServicesTable).toBeVisible();
  }

  async expectProjectServiceVisible(serviceName: string): Promise<void> {
    await expect(this.projectOverviewServiceRow(serviceName)).toBeVisible();
  }

  private isProjectsSearchResponse(response: Response, searchQuery: string): boolean {
    if (!isSuccessfulApiResponse(response, compartmentProjectsApiPathname)) {
      return false;
    }

    const responseUrl: URL = new URL(response.url());
    return responseUrl.searchParams.get('search') === searchQuery;
  }

  private isProjectsSearchUrl(url: URL, searchQuery: string): boolean {
    return isConsolePathname(url, compartmentBrowserProjectsPathname) && url.searchParams.get('q') === searchQuery;
  }

  private isProjectOverviewResponse(response: Response, projectName: string): boolean {
    return isSuccessfulApiResponse(response, buildCompartmentProjectOverviewApiPathname(projectName));
  }

  private isProjectOverviewUrl(url: URL, projectName: string): boolean {
    return isConsolePathname(url, buildCompartmentConsoleProjectOverviewPathname(projectName));
  }

  private projectRow(projectName: string): Locator {
    return this.page.getByRole('row').filter({
      has: this.page.getByRole('cell', { exact: true, name: projectName }),
    });
  }

  private projectOverviewServiceRow(serviceName: string): Locator {
    return this.projectOverviewServicesTable.getByRole('row').filter({
      has: this.page.locator('td:first-child').getByText(serviceName, { exact: true }),
    });
  }
}

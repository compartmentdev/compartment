import {
  compartmentAuthLoginDiscoveryPathname,
  compartmentAuthLoginPathname,
  compartmentBrowserProjectsPathname,
  compartmentProjectsApiPathname,
} from '@compartment/contracts/browser';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { ConsoleE2eAccount } from '../support/console-e2e-account';
import { isSuccessfulApiResponse } from '../support/browser-api';
import { isConsolePathname } from '../support/console-paths';

export class LoginPage {
  private readonly account: ConsoleE2eAccount;
  private readonly continueButton: Locator;
  private readonly emailInput: Locator;
  private readonly loginButton: Locator;
  private readonly loginHeading: Locator;
  private readonly page: Page;
  private readonly passwordInput: Locator;

  constructor(page: Page, account: ConsoleE2eAccount) {
    this.account = account;
    this.continueButton = page.getByRole('button', { name: /^Continue$/ });
    this.emailInput = page.getByPlaceholder('Email address');
    this.loginButton = page.getByRole('button', { name: /^Login$/ });
    this.loginHeading = page.getByRole('heading', { name: 'Login' });
    this.page = page;
    this.passwordInput = page.getByPlaceholder('Password');
  }

  async login(authenticatedLocator: Locator): Promise<void> {
    await expect(this.loginHeading).toBeVisible();
    await this.completeInitialStep();
    await this.submitCredentials(authenticatedLocator);
  }

  async loginAndFollowAppRedirect(redirectUrl: string, authenticatedLocator: Locator): Promise<void> {
    await expect(this.loginHeading).toBeVisible();
    await this.completeInitialStep();
    await this.submitCredentialsForAppRedirect(redirectUrl, authenticatedLocator);
  }

  private async completeInitialStep(): Promise<void> {
    const step: LoginInitialStep = await this.readInitialStep();

    if (step === 'discovery') {
      await this.submitEmailDiscovery();
      await this.selectOrganizationIfRequired();
    }
  }

  private async readInitialStep(): Promise<LoginInitialStep> {
    return await Promise.any<LoginInitialStep>([
      this.continueButton.waitFor({ state: 'visible' }).then((): LoginInitialStep => 'discovery'),
      this.loginButton.waitFor({ state: 'visible' }).then((): LoginInitialStep => 'credentials'),
    ]);
  }

  private async submitEmailDiscovery(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.continueButton).toBeVisible();
    await this.emailInput.fill(this.account.email);
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAuthLoginDiscoveryPathname),
      ),
      this.continueButton.click(),
    ]);
  }

  private async selectOrganizationIfRequired(): Promise<void> {
    const organizationChoiceButton: Locator = this.page.getByRole('button', {
      exact: true,
      name: this.account.organizationName,
    });
    const shouldSelectOrganization: boolean = await Promise.race([
      organizationChoiceButton.waitFor({ state: 'visible', timeout: 5_000 }).then((): boolean => true),
      this.passwordInput.waitFor({ state: 'visible', timeout: 5_000 }).then((): boolean => false),
    ]).catch((): boolean => false);
    if (!shouldSelectOrganization) {
      return;
    }

    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAuthLoginDiscoveryPathname),
      ),
      organizationChoiceButton.click(),
    ]);
  }

  private async submitCredentials(authenticatedLocator: Locator): Promise<void> {
    await expect(this.passwordInput).toBeVisible();
    await expect(this.loginButton).toBeVisible();
    await this.fillCredentialEmailIfEditable();
    await this.passwordInput.fill(this.account.password);
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAuthLoginPathname),
      ),
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentProjectsApiPathname),
      ),
      this.page.waitForURL((url: URL): boolean => isConsolePathname(url, compartmentBrowserProjectsPathname)),
      this.loginButton.click(),
    ]);
    await expect(authenticatedLocator).toBeVisible();
  }

  private async submitCredentialsForAppRedirect(redirectUrl: string, authenticatedLocator: Locator): Promise<void> {
    await expect(this.passwordInput).toBeVisible();
    await expect(this.loginButton).toBeVisible();
    await this.fillCredentialEmailIfEditable();
    await this.passwordInput.fill(this.account.password);
    await Promise.all([
      this.page.waitForResponse((response: Response): boolean =>
        isSuccessfulApiResponse(response, compartmentAuthLoginPathname),
      ),
      this.page.waitForURL(redirectUrl),
      this.loginButton.click(),
    ]);
    await expect(authenticatedLocator).toBeVisible();
  }

  private async fillCredentialEmailIfEditable(): Promise<void> {
    if (await this.emailInput.isVisible()) {
      await this.emailInput.fill(this.account.email);
    }
  }
}

type LoginInitialStep = 'credentials' | 'discovery';

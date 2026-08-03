import { hasText } from '@compartment/utils';
import type { CliIo } from '../app.types';
import { deriveRegisterOrganizationName } from './organization-name-default';
import { readPromptLine, readSecretPromptLine } from './prompt-reader';
import {
  assertEmail,
  validateInstallEmail,
  validateInstallOrganization,
  validateLoginEmail,
  validatePassword,
  validateProjectName,
  validateRemoteName,
} from './prompt.validation';

export interface RemoteSelectionPromptOption {
  current: boolean;
  name: string;
}

const newPasswordAttemptLimit: number = 3;

export async function promptRegisterEmail(io: CliIo, configuredEmail?: string): Promise<string> {
  if (hasText(configuredEmail)) {
    assertEmail(configuredEmail);
    return configuredEmail;
  }

  return await promptValidatedVisibleText(io, 'Admin email', validateInstallEmail);
}

export async function promptRegisterOrganization(
  io: CliIo,
  adminEmail: string,
  configuredOrganization?: string,
): Promise<string> {
  if (hasText(configuredOrganization)) {
    return configuredOrganization;
  }

  const defaultOrganizationName: string | undefined = deriveRegisterOrganizationName(adminEmail);
  return await promptValidatedVisibleText(
    io,
    'Organization name',
    validateInstallOrganization,
    defaultOrganizationName,
  );
}

export async function promptOrganizationName(io: CliIo, configuredOrganization?: string): Promise<string> {
  if (hasText(configuredOrganization)) {
    return configuredOrganization;
  }

  return await promptValidatedVisibleText(io, 'Organization name', validateInstallOrganization);
}

export async function promptLoginEmail(io: CliIo, configuredEmail?: string): Promise<string> {
  if (hasText(configuredEmail)) {
    assertEmail(configuredEmail);
    return configuredEmail;
  }

  return await promptValidatedVisibleText(io, 'Email', validateLoginEmail);
}

export async function promptProjectName(io: CliIo, defaultName?: string): Promise<string> {
  return await promptValidatedVisibleText(io, 'Project name', validateProjectName, defaultName);
}

export async function promptRemoteName(io: CliIo, defaultName?: string): Promise<string> {
  return await promptValidatedVisibleText(io, 'Remote name', validateRemoteName, defaultName);
}

export async function promptActivationToken(io: CliIo, configuredToken?: string): Promise<string> {
  if (hasText(configuredToken)) {
    return configuredToken;
  }

  for (;;) {
    const token: string = await promptVisibleText(io, 'Invitation token');
    if (hasText(token)) {
      return token;
    }

    writePromptError(io, 'Invitation token is required.');
  }
}

export async function promptNewPassword(io: CliIo, label: string = 'Admin password'): Promise<string> {
  for (let attempt: number = 1; attempt <= newPasswordAttemptLimit; attempt += 1) {
    const password: string = await promptSecretText(io, label);
    const passwordError: string | undefined = validatePassword(password);
    if (passwordError !== undefined) {
      writePromptError(io, passwordError);
      continue;
    }

    const passwordConfirmation: string = await promptSecretText(io, 'Confirm password');
    if (password === passwordConfirmation) {
      return password;
    }

    writePromptError(io, 'Password confirmation does not match.');
  }

  throw new Error(`Password entry failed after ${String(newPasswordAttemptLimit)} attempts.`);
}

export async function promptProjectBindingSave(io: CliIo, remoteName: string): Promise<boolean> {
  return await promptYesNoChoice(io, `Bind this repo to remote "${remoteName}"? [Y/n]: `, true);
}

export async function promptProjectBindingRepair(io: CliIo, remoteName: string): Promise<boolean> {
  return await promptYesNoChoice(io, `Repair the saved repo binding to use remote "${remoteName}"? [Y/n]: `, true);
}

export async function promptProjectBindingScope(
  io: CliIo,
  projectScopeLabel: string,
  gitRootScopeLabel: string,
): Promise<'git-root' | 'project-root'> {
  for (;;) {
    const answer: string = (
      await readPromptLine(
        io,
        `Save binding at Git root (${gitRootScopeLabel}) or project scope (${projectScopeLabel})? [git-root/project-root]: `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer === '' || answer === 'git-root') {
      return 'git-root';
    }
    if (answer === 'project-root') {
      return 'project-root';
    }

    writePromptError(io, 'Enter `git-root` or `project-root`.');
  }
}

export async function promptRemoteSelection(
  io: CliIo,
  options: readonly RemoteSelectionPromptOption[],
): Promise<string> {
  io.stderr('Multiple remotes are configured and this repo is not bound to one. Select a remote to deploy to:\n');
  for (const [index, option] of options.entries()) {
    io.stderr(`  ${String(index + 1)}. ${option.name}${option.current ? ' (current)' : ''}\n`);
  }

  for (;;) {
    const answer: string = (await readPromptLine(io, 'Remote [1]: ')).trim();
    const selectedIndex: number = answer === '' ? 0 : Number(answer) - 1;
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < options.length) {
      return options[selectedIndex]!.name;
    }

    writePromptError(io, `Enter a number from 1 to ${String(options.length)}.`);
  }
}

async function promptSecretText(io: CliIo, label: string): Promise<string> {
  const value: string = await readSecretPromptLine(io, buildPromptLabel(label));
  io.stderr('\n');
  return value.trim();
}

export async function promptValidatedVisibleText(
  io: CliIo,
  label: string,
  validate: (value: string) => string | undefined,
  defaultValue?: string,
): Promise<string> {
  for (;;) {
    const value: string = await promptVisibleText(io, label, defaultValue);
    const errorMessage: string | undefined = validate(value);
    if (errorMessage === undefined) {
      return value;
    }

    writePromptError(io, errorMessage);
  }
}

export async function promptRequiredVisibleText(io: CliIo, label: string): Promise<string> {
  for (;;) {
    const value: string = await promptVisibleText(io, label);
    if (value !== '') {
      return value;
    }
    writePromptError(io, `${label} is required.`);
  }
}

export async function promptVisibleText(io: CliIo, label: string, defaultValue?: string): Promise<string> {
  const value: string = (await readPromptLine(io, buildPromptLabel(label, defaultValue))).trim();
  if (value === '' && defaultValue !== undefined) {
    return defaultValue;
  }

  return value;
}

async function promptYesNoChoice(io: CliIo, label: string, defaultValue: boolean): Promise<boolean> {
  for (;;) {
    const answer: string = (await readPromptLine(io, label)).trim().toLowerCase();
    if (answer === '') {
      return defaultValue;
    }
    if (answer === 'y' || answer === 'yes') {
      return true;
    }
    if (answer === 'n' || answer === 'no') {
      return false;
    }

    writePromptError(io, 'Enter `y` or `n`.');
  }
}

function buildPromptLabel(label: string, defaultValue?: string): string {
  if (defaultValue === undefined) {
    return `${label}: `;
  }

  return `${label} [${defaultValue}]: `;
}

function writePromptError(io: CliIo, message: string): void {
  io.stderr(`${message}\n`);
}

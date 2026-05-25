import { hasText, isValidEmailAddress } from '@compartment/utils';
import { validateProjectNameFormat } from '../services/project-name.service';
import { validateRemoteNameFormat } from '../services/remote-name.service';

export function assertEmail(email: string): void {
  const errorMessage: string | undefined = validateEmail(email);
  if (errorMessage !== undefined) {
    throw new Error(errorMessage);
  }
}

export function validateInstallEmail(email: string): string | undefined {
  if (!hasText(email)) {
    return 'Email is required for install.';
  }

  return validateEmail(email);
}

export function validateLoginEmail(email: string): string | undefined {
  if (!hasText(email)) {
    return 'Email is required for login.';
  }

  return validateEmail(email);
}

export function validateInstallOrganization(organizationName: string): string | undefined {
  return hasText(organizationName) ? undefined : 'Organization name is required for install.';
}

export function validateProjectName(projectName: string): string | undefined {
  if (!hasText(projectName)) {
    return 'Project name is required.';
  }

  return validateProjectNameFormat(projectName);
}

export function validateRemoteName(remoteName: string): string | undefined {
  if (!hasText(remoteName)) {
    return 'Remote name is required.';
  }

  return validateRemoteNameFormat(remoteName);
}

export function validatePassword(password: string): string | undefined {
  return password.length < 8 ? 'Password must be at least 8 characters.' : undefined;
}

export function parsePort(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) {
    return undefined;
  }

  const port: number = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }

  return port;
}

function validateEmail(email: string): string | undefined {
  return isValidEmailAddress(email) ? undefined : 'Email must be a valid address.';
}

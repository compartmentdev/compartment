import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hasText } from '@compartment/utils';
import { parse } from 'dotenv';
import type { CompartmentDevInstallContext } from './repo-root.types';

interface PackageJsonNameCandidate {
  name?: string;
}

export async function readCompartmentDevInstallContext(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompartmentDevInstallContext> {
  const repositoryRoot: string = resolveCompartmentRepoRoot(cwd);
  const values: Record<string, string> = await readEnvironmentFile(resolve(repositoryRoot, '.env'));
  const apiUrl: string | undefined = values.COMPARTMENT_API_URL;
  if (!hasText(apiUrl)) {
    throw new Error(
      `The compartment repo root .env is missing COMPARTMENT_API_URL at ${resolve(repositoryRoot, '.env')}.`,
    );
  }
  const installToken: string | undefined = env.COMPARTMENT_INSTALL_TOKEN;
  if (!hasText(installToken)) {
    throw new Error('The environment is missing COMPARTMENT_INSTALL_TOKEN.');
  }

  return { apiUrl, installToken };
}

function resolveCompartmentRepoRoot(cwd: string = process.cwd()): string {
  const currentDirectory: string = resolve(cwd);
  if (isCompartmentRepoRoot(currentDirectory)) {
    return currentDirectory;
  }

  throw new Error('Expected to run from the compartment repository root.');
}

async function readEnvironmentFile(filePath: string): Promise<Record<string, string>> {
  const content: string = await readFile(filePath, 'utf8');
  return parse(content);
}

function isCompartmentRepoRoot(directory: string): boolean {
  const workspacePath: string = resolve(directory, 'pnpm-workspace.yaml');
  const rootPackageJsonPath: string = resolve(directory, 'package.json');
  const cliPackageJsonPath: string = resolve(directory, 'packages/cli/package.json');

  return (
    existsSync(workspacePath) &&
    existsSync(cliPackageJsonPath) &&
    readPackageName(rootPackageJsonPath) === 'compartment'
  );
}

function readPackageName(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const value: PackageJsonNameCandidate = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as PackageJsonNameCandidate;
    if (typeof value.name === 'string') {
      return value.name;
    }
  } catch {
    return null;
  }

  return null;
}

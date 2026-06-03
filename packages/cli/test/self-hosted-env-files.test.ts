import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('self-hosted env file contracts', (): void => {
  it('declares dev env names plus self-hosted runtime identity names', async (): Promise<void> => {
    const repositoryRoot: string = resolve(__dirname, '../../..');
    const devExamplePath: string = resolve(repositoryRoot, '.env.example');
    const selfHostedExamplePath: string = resolve(repositoryRoot, '.env.self-hosted.example');
    const devExampleContents: string = await readFile(devExamplePath, 'utf8');
    const selfHostedExampleContents: string = await readFile(selfHostedExamplePath, 'utf8');
    expect(readDeclaredEnvVariableNames(selfHostedExampleContents)).toEqual(
      [...readDeclaredEnvVariableNames(devExampleContents), 'COMPARTMENT_RUNTIME_GID', 'COMPARTMENT_RUNTIME_UID'].sort(
        (left: string, right: string): number => left.localeCompare(right),
      ),
    );
    expect(selfHostedExampleContents).not.toContain('${');
    expect(selfHostedExampleContents).not.toContain('$(');
  });
});

function readDeclaredEnvVariableNames(contents: string): string[] {
  const variableNames: Set<string> = new Set<string>(
    contents
      .split('\n')
      .map((line: string): string => line.trim())
      .filter((line: string): boolean => line !== '' && !line.startsWith('#'))
      .map(getVariableNameFromEnvLine),
  );

  return getSortedStrings([...variableNames]);
}

function getVariableNameFromEnvLine(line: string): string {
  const match: RegExpExecArray | null = /^[^=]+/.exec(line);
  if (match === null) {
    throw new Error(`Expected an env assignment line, received: ${line}`);
  }

  return match[0];
}

function getSortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left: string, right: string): number => left.localeCompare(right));
}

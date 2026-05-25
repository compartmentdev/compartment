import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { VariableImportEntry } from '@compartment/contracts';
import { parse } from 'dotenv';

// Keep duplicate detection aligned with dotenv.parse semantics.
const dotenvLinePattern: RegExp =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

export async function readVariableImportEntries(filePath: string): Promise<VariableImportEntry[]> {
  const resolvedFilePath: string = resolve(filePath);
  const content: string = await readFile(resolvedFilePath, 'utf8');
  assertSupportedDotenvContent(content, resolvedFilePath);
  const duplicateKeyNames: string[] = listDuplicateDotenvKeys(content);

  if (duplicateKeyNames.length > 0) {
    throw new Error(`Duplicate imported variable keys in ${resolvedFilePath}: ${duplicateKeyNames.join(', ')}.`);
  }

  const entries: VariableImportEntry[] = Object.entries(parse(content)).map(
    ([keyName, value]: [string, string]): VariableImportEntry => ({
      keyName,
      value,
    }),
  );
  if (entries.length === 0) {
    throw new Error(`Import file ${resolvedFilePath} does not contain any variables.`);
  }

  return entries;
}

function listDuplicateDotenvKeys(content: string): string[] {
  const seenKeyNames: Set<string> = new Set<string>();
  const duplicateKeyNames: Set<string> = new Set<string>();

  for (const keyName of listParsedDotenvKeyNames(content)) {
    if (seenKeyNames.has(keyName)) {
      duplicateKeyNames.add(keyName);
    } else {
      seenKeyNames.add(keyName);
    }
  }

  return [...duplicateKeyNames].sort((left: string, right: string): number => left.localeCompare(right));
}

function listParsedDotenvKeyNames(content: string): string[] {
  const keyNames: string[] = [];
  const normalizedContent: string = normalizeDotenvContent(content);
  const pattern: RegExp = createDotenvLinePattern();

  let match: RegExpExecArray | null = pattern.exec(normalizedContent);
  while (match !== null) {
    const keyName: string | undefined = match[1];
    if (keyName !== undefined) {
      keyNames.push(keyName);
    }
    match = pattern.exec(normalizedContent);
  }

  return keyNames;
}

function assertSupportedDotenvContent(content: string, resolvedFilePath: string): void {
  const normalizedContent: string = normalizeDotenvContent(content);
  const pattern: RegExp = createDotenvLinePattern();
  let cursor: number = 0;

  let match: RegExpExecArray | null = pattern.exec(normalizedContent);
  while (match !== null) {
    assertSupportedDotenvGap(normalizedContent.slice(cursor, match.index), resolvedFilePath);
    cursor = pattern.lastIndex;
    match = pattern.exec(normalizedContent);
  }

  assertSupportedDotenvGap(normalizedContent.slice(cursor), resolvedFilePath);
}

function assertSupportedDotenvGap(content: string, resolvedFilePath: string): void {
  const lines: string[] = content.split('\n');

  for (const line of lines) {
    const trimmedLine: string = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    throw new Error(`Import file ${resolvedFilePath} contains unsupported dotenv content: ${trimmedLine}.`);
  }
}

function createDotenvLinePattern(): RegExp {
  return new RegExp(dotenvLinePattern.source, dotenvLinePattern.flags);
}

function normalizeDotenvContent(content: string): string {
  return content.replace(/\r\n?/gm, '\n');
}

import { ZodError, type ZodIssue } from 'zod';

export function formatSchemaValidationError(error: Error, fileName: string): Error {
  if (!(error instanceof ZodError)) {
    return error;
  }

  const issues: string[] = listDetailedSchemaIssues(error.issues).map(
    (issue: ZodIssue): string => `${fileName}: ${formatSchemaFieldPath(issue.path)}: ${issue.message}`,
  );
  return new Error(issues.join('\n'));
}

function listDetailedSchemaIssues(issues: ZodIssue[]): ZodIssue[] {
  return issues.flatMap((issue: ZodIssue): ZodIssue[] => {
    if (issue.code !== 'invalid_union') {
      return [issue];
    }

    return issue.unionErrors
      .map((unionError: ZodError): ZodIssue[] => listDetailedSchemaIssues(unionError.issues))
      .sort(
        (left: ZodIssue[], right: ZodIssue[]): number => schemaIssueDetailScore(right) - schemaIssueDetailScore(left),
      )[0]!;
  });
}

function schemaIssueDetailScore(issues: ZodIssue[]): number {
  return issues.reduce((score: number, issue: ZodIssue): number => score + issue.path.length, 0);
}

function formatSchemaFieldPath(path: (number | string)[]): string {
  if (path.length === 0) {
    return '(root)';
  }

  return path.reduce(
    (formattedPath: string, segment: number | string): string =>
      typeof segment === 'number'
        ? `${formattedPath}[${String(segment)}]`
        : appendSchemaFieldPathSegment(formattedPath, segment),
    '',
  );
}

function appendSchemaFieldPathSegment(formattedPath: string, segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(segment)) {
    return `${formattedPath}${formattedPath === '' ? '' : '.'}${segment}`;
  }

  return `${formattedPath}[${JSON.stringify(segment)}]`;
}

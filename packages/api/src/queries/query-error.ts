const uniqueConstraintErrorCode: string = '23505';

interface ErrorWithCode {
  code?: string;
}

interface ErrorWithConstraint {
  constraint?: string;
}

interface ErrorWithCause {
  cause?: Error | NodeJS.ErrnoException | null;
}

export function isUniqueConstraintError(error: Error | NodeJS.ErrnoException | null | undefined): boolean {
  return (
    getErrorCode(error) === uniqueConstraintErrorCode ||
    getErrorCode(getErrorCause(error)) === uniqueConstraintErrorCode
  );
}

export function readConstraintName(error: Error | NodeJS.ErrnoException | null | undefined): string | undefined {
  return getConstraintName(error) ?? getConstraintName(getErrorCause(error));
}

function getErrorCause(
  error: Error | NodeJS.ErrnoException | null | undefined,
): Error | NodeJS.ErrnoException | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }

  return (error as ErrorWithCause).cause ?? undefined;
}

function getErrorCode(error: Error | NodeJS.ErrnoException | null | undefined): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return (error as ErrorWithCode).code;
}

function getConstraintName(error: Error | NodeJS.ErrnoException | null | undefined): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return undefined;
  }

  return (error as ErrorWithConstraint).constraint;
}

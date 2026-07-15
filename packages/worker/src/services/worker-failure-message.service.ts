export function readWorkerFailureMessage(error: Error | undefined, fallbackMessage: string): string {
  return error?.message ?? fallbackMessage;
}

interface JobStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}

interface ObservedJobStatus {
  conditions?: JobStatusCondition[] | undefined;
  succeeded?: number | undefined;
}

export function jobStatusTerminal(status: ObservedJobStatus | undefined): boolean {
  return (status?.succeeded ?? 0) > 0 || jobStatusFailed(status);
}

export function jobStatusFailed(status: ObservedJobStatus | undefined): boolean {
  return (
    status?.conditions?.some(
      (condition: JobStatusCondition): boolean => condition.type === 'Failed' && condition.status === 'True',
    ) ?? false
  );
}

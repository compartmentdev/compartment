import { isBuildSourceArchiveFetchRetryLine } from '../build-source-archive-fetch';
import type { WorkerBuildJobLogRecord } from './worker-build-job.types';
import { readBuildLogRecords } from './worker-build-log-record';

export function readCapturedBuildFailure(logs: string): string {
  const records: WorkerBuildJobLogRecord[] = readBuildLogRecords(logs);
  const record: WorkerBuildJobLogRecord | undefined = records.findLast(
    (candidate: WorkerBuildJobLogRecord): boolean => candidate.type === 'failure',
  );
  const message: string = record?.type === 'failure' ? record.message : 'runner exited without a structured failure';
  const sourceFetchDiagnostics: string = records
    .filter(
      (candidate: WorkerBuildJobLogRecord): boolean =>
        candidate.type === 'progress' && isBuildSourceArchiveFetchRetryLine(candidate.progress.message),
    )
    .map((candidate: WorkerBuildJobLogRecord): string =>
      candidate.type === 'progress' ? candidate.progress.message : '',
    )
    .join('\n');
  const terminalProgress: string = records
    .filter(
      (candidate: WorkerBuildJobLogRecord): boolean =>
        candidate.type === 'progress' && !isBuildSourceArchiveFetchRetryLine(candidate.progress.message),
    )
    .slice(-20)
    .map((candidate: WorkerBuildJobLogRecord): string =>
      candidate.type === 'progress' ? `[${candidate.progress.stream}] ${candidate.progress.message}` : '',
    )
    .join('\n');
  return [
    message,
    sourceFetchDiagnostics === '' ? '' : `Source archive fetch diagnostics:\n${sourceFetchDiagnostics}`,
    terminalProgress === '' ? '' : `BuildKit terminal output:\n${terminalProgress}`,
  ]
    .filter((section: string): boolean => section !== '')
    .join('\n');
}

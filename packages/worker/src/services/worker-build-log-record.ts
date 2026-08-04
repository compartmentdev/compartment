import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import type { JsonValue } from '@compartment/utils';
import type { WorkerBuildJobLogRecord } from './worker-build-job.types';

type JsonObject = Record<string, JsonValue>;

export function readBuildLogRecords(logs: string): WorkerBuildJobLogRecord[] {
  return logs.split('\n').flatMap((line: string): WorkerBuildJobLogRecord[] => {
    const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecord(line);
    return record === undefined ? [] : [record];
  });
}

export function readBuildLogRecord(line: string): WorkerBuildJobLogRecord | undefined {
  try {
    const parsed: JsonValue = JSON.parse(line) as JsonValue;
    return readWorkerBuildJobLogRecord(parsed);
  } catch {
    return undefined;
  }
}

function readWorkerBuildJobLogRecord(value: JsonValue): WorkerBuildJobLogRecord | undefined {
  if (!isJsonObject(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'failure') {
    return typeof value.message === 'string' ? { message: value.message, type: 'failure' } : undefined;
  }
  if (value.type === 'progress') {
    const progress: DockerProgressLine | undefined = readDockerProgressLine(value.progress);
    return progress === undefined ? undefined : { progress, type: 'progress' };
  }
  if (value.type === 'result') {
    const result: DockerBuildImageResult | undefined = readDockerBuildImageResult(value.result);
    return result === undefined ? undefined : { result, type: 'result' };
  }
  return undefined;
}

function readDockerProgressLine(value: JsonValue | undefined): DockerProgressLine | undefined {
  if (
    !isJsonObject(value) ||
    typeof value.message !== 'string' ||
    (value.stream !== 'stderr' && value.stream !== 'stdout')
  ) {
    return undefined;
  }
  return { message: value.message, stream: value.stream };
}

function readDockerBuildImageResult(value: JsonValue | undefined): DockerBuildImageResult | undefined {
  if (!isJsonObject(value) || typeof value.imageRef !== 'string' || typeof value.pushed !== 'boolean') {
    return undefined;
  }
  return { imageRef: value.imageRef, pushed: value.pushed };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

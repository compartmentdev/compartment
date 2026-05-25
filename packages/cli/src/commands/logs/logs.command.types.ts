export interface LogsFollowCursor {
  lastTimestamp: string | null;
  seenCountsAtTimestamp: Map<string, number>;
}

export interface FollowAbortRegistration {
  abort: () => void;
  stdin: NodeJS.ReadableStream;
}

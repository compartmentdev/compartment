export interface UsageInterval {
  cpuMillicores: number;
  memoryBytes: number;
  observedAt: Date;
  previousObservedAt: Date;
}

export interface UsageHourSlice {
  cpuMillicoreSeconds: number;
  hourBucket: Date;
  memoryByteSeconds: number;
}

export interface JobUsageSlice {
  durationSeconds: number;
  hourBucket: Date;
  jobCount: number;
}

export interface ResourceProductJobWaitContext {
  deadlineAt: number;
  nextQueueRefreshAt: number;
  predecessorToken: string;
}

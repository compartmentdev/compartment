import type { ProjectResourceRow } from '../queries/resources.query.types';

interface CompletedResourceOperation<Result> {
  nextCandidate: null;
  result: Result;
}

interface RetryResourceOperation {
  nextCandidate: ProjectResourceRow;
}

export type LockedResourceOperationResult<Result> = CompletedResourceOperation<Result> | RetryResourceOperation;

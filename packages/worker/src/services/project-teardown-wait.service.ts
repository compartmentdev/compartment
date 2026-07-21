import type { KubeManifest, KubeObservedManifest, KubeRuntime } from '@compartment/kube-runtime';

const teardownPollIntervalMs: number = 100;
const teardownNotTerminatingTimeoutMs: number = 30_000;
const teardownHeartbeatIntervalMs: number = 10_000;
const teardownProgressObservationIntervalMs: number = 10_000;
const teardownStalledObservationLimit: number = 90;

type ProjectTeardownHeartbeat = () => Promise<void>;

interface ProjectNamespaceDeletionProgress {
  nextHeartbeatAt: number;
  nextObservationAt: number;
  signature: string | null;
  stalledObservations: number;
}

export async function waitForProjectNamespaceDeletion(
  runtime: KubeRuntime,
  namespace: KubeManifest,
  heartbeat: ProjectTeardownHeartbeat,
  absoluteTimeoutMs: number,
): Promise<void> {
  const absoluteDeadline: number = Date.now() + absoluteTimeoutMs;
  const nonTerminatingDeadline: number = Date.now() + teardownNotTerminatingTimeoutMs;
  const progress: ProjectNamespaceDeletionProgress = createProjectNamespaceDeletionProgress();
  for (;;) {
    const observed: KubeObservedManifest | null = await readProjectNamespace(
      runtime,
      namespace,
      progress,
      heartbeat,
      absoluteDeadline,
    );
    assertAbsoluteTeardownDeadline(Date.now(), absoluteDeadline);
    if (observed === null || namespaceWasReplaced(namespace, observed)) {
      return;
    }
    await observePresentNamespace(observed, progress, nonTerminatingDeadline, heartbeat);
    await waitForTeardownPoll();
  }
}

async function readProjectNamespace(
  runtime: KubeRuntime,
  namespace: KubeManifest,
  progress: ProjectNamespaceDeletionProgress,
  heartbeat: ProjectTeardownHeartbeat,
  absoluteDeadline: number,
): Promise<KubeObservedManifest | null> {
  for (;;) {
    try {
      return await runtime.read(namespace);
    } catch {
      assertAbsoluteTeardownDeadline(Date.now(), absoluteDeadline);
      await observeNamespaceReadFailure(progress, heartbeat, Date.now());
      await waitForTeardownPoll();
    }
  }
}

async function observeNamespaceReadFailure(
  progress: ProjectNamespaceDeletionProgress,
  heartbeat: ProjectTeardownHeartbeat,
  now: number,
): Promise<void> {
  if (now >= progress.nextObservationAt) {
    progress.stalledObservations += 1;
    progress.nextObservationAt = now + teardownProgressObservationIntervalMs;
    if (progress.stalledObservations >= teardownStalledObservationLimit) {
      throw new Error('Project Kubernetes namespace teardown could not be observed.');
    }
  }
  await heartbeatProjectTeardown(progress, heartbeat, now);
}

function createProjectNamespaceDeletionProgress(): ProjectNamespaceDeletionProgress {
  const now: number = Date.now();
  return {
    nextHeartbeatAt: now + teardownHeartbeatIntervalMs,
    nextObservationAt: now,
    signature: null,
    stalledObservations: 0,
  };
}

async function observePresentNamespace(
  namespace: KubeObservedManifest,
  progress: ProjectNamespaceDeletionProgress,
  nonTerminatingDeadline: number,
  heartbeat: ProjectTeardownHeartbeat,
): Promise<void> {
  const now: number = Date.now();
  if (namespace.metadata?.deletionTimestamp === undefined) {
    assertNamespaceEnteredTerminating(now, nonTerminatingDeadline);
    return;
  }
  observeNamespaceDeletionProgress(namespace, progress, now);
  await heartbeatProjectTeardown(progress, heartbeat, now);
}

function assertNamespaceEnteredTerminating(now: number, deadline: number): void {
  if (now >= deadline) {
    throw new Error('Project Kubernetes namespace did not enter the Terminating state.');
  }
}

function assertAbsoluteTeardownDeadline(now: number, deadline: number): void {
  if (now >= deadline) {
    throw new Error('Project Kubernetes namespace teardown did not finish within the absolute teardown deadline.');
  }
}

function observeNamespaceDeletionProgress(
  namespace: KubeObservedManifest,
  progress: ProjectNamespaceDeletionProgress,
  now: number,
): void {
  if (now < progress.nextObservationAt) {
    return;
  }
  const signature: string = namespaceDeletionProgressSignature(namespace);
  progress.stalledObservations = signature === progress.signature ? progress.stalledObservations + 1 : 0;
  progress.signature = signature;
  progress.nextObservationAt = now + teardownProgressObservationIntervalMs;
  if (progress.stalledObservations >= teardownStalledObservationLimit) {
    throw new Error('Project Kubernetes namespace teardown stopped making progress.');
  }
}

async function heartbeatProjectTeardown(
  progress: ProjectNamespaceDeletionProgress,
  heartbeat: ProjectTeardownHeartbeat,
  now: number,
): Promise<void> {
  if (now < progress.nextHeartbeatAt) {
    return;
  }
  await heartbeat();
  progress.nextHeartbeatAt = now + teardownHeartbeatIntervalMs;
}

function namespaceDeletionProgressSignature(namespace: KubeObservedManifest): string {
  return JSON.stringify([namespace.metadata?.resourceVersion ?? null, namespace.metadata?.finalizers ?? []]);
}

function namespaceWasReplaced(expected: KubeManifest, observed: KubeObservedManifest): boolean {
  const expectedUid: string | undefined = expected.metadata?.uid;
  return expectedUid !== undefined && observed.metadata?.uid !== expectedUid;
}

async function waitForTeardownPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, teardownPollIntervalMs);
  });
}

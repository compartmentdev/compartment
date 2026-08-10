import { connect, type Socket } from 'node:net';
import type { ResourceReachabilityTarget } from '../resource-reachability-probe.types';

const connectTimeoutMs: number = 2_000;
const retryDelayMs: number = 250;

/**
 * Waits until every declared resource endpoint accepts a connection from this process.
 *
 * It runs inside the Pod that will dial those resources, which is the whole point: on the supported CNI a refusal
 * is indistinguishable from nothing listening, and a Pod's own address only joins the policy peer set on a later
 * controller sync. Only a retry from this address can tell the two apart, and only this address matters.
 *
 * Each target's budget is its own declared readiness timeout, measured from when this process started rather than
 * from any control-plane instant, so a Pod scheduled long after the decision still gets the whole budget.
 */
export async function awaitResourceReachability(targets: readonly ResourceReachabilityTarget[]): Promise<void> {
  const startedAt: number = Date.now();
  for (const target of targets) {
    await awaitResourceTarget(target, startedAt);
  }
}

function unreachableResourceMessage(target: ResourceReachabilityTarget): string {
  return `Resource endpoint ${target.host}:${target.port} did not accept a connection within ${target.timeoutMs}ms.`;
}

async function awaitResourceTarget(target: ResourceReachabilityTarget, startedAt: number): Promise<void> {
  for (;;) {
    const remainingMs: number = target.timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(unreachableResourceMessage(target));
    }
    // A dropped packet blocks for the socket timeout, so the attempt itself is bounded too. Without that a short
    // budget overshoots by the whole attempt, and a Job's probe can lose the race against activeDeadlineSeconds.
    if (await acceptsConnection(target, Math.min(connectTimeoutMs, remainingMs))) {
      return;
    }
    await delay(Math.min(retryDelayMs, Math.max(0, target.timeoutMs - (Date.now() - startedAt))));
  }
}

async function acceptsConnection(target: ResourceReachabilityTarget, attemptTimeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve: (accepted: boolean) => void): void => {
    const socket: Socket = connect({ host: target.host, port: target.port });
    const settle: (accepted: boolean) => void = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(attemptTimeoutMs);
    socket.once('connect', (): void => settle(true));
    socket.once('error', (): void => settle(false));
    socket.once('timeout', (): void => settle(false));
  });
}

async function delay(durationMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, durationMs);
  });
}

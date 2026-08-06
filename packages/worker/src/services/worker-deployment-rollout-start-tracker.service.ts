interface RetainedCandidateRunningStart {
  expiresAt: number;
  recoveryRestarted: boolean;
  startedAt: number | null;
}

export class DeploymentRolloutStartTracker {
  readonly #starts: Map<string, RetainedCandidateRunningStart> = new Map<string, RetainedCandidateRunningStart>();

  retain(deploymentId: string, observedStartedAt: Date | null, maximumDeadlineAt: Date): Date | null {
    this.#pruneExpired(Date.now(), deploymentId);
    const retained: RetainedCandidateRunningStart | undefined = this.#starts.get(deploymentId);
    if (retained === undefined && observedStartedAt === null) {
      return null;
    }
    const observedStart: number | null = observedStartedAt?.getTime() ?? null;
    const startedAt: number | null = earliestStart(retained?.startedAt ?? null, observedStart);
    this.#starts.set(deploymentId, {
      expiresAt: Math.min(retained?.expiresAt ?? Number.POSITIVE_INFINITY, maximumDeadlineAt.getTime()),
      recoveryRestarted: retained?.recoveryRestarted ?? false,
      startedAt,
    });
    return startedAt === null ? null : new Date(startedAt);
  }

  canRestartRecovery(deploymentId: string): boolean {
    return this.#starts.get(deploymentId)?.recoveryRestarted !== true;
  }

  markRecoveryRestarted(deploymentId: string, maximumDeadlineAt: Date): void {
    const retained: RetainedCandidateRunningStart | undefined = this.#starts.get(deploymentId);
    this.#starts.set(deploymentId, {
      expiresAt: Math.min(retained?.expiresAt ?? Number.POSITIVE_INFINITY, maximumDeadlineAt.getTime()),
      recoveryRestarted: true,
      startedAt: null,
    });
  }

  clear(deploymentId: string): void {
    this.#starts.delete(deploymentId);
  }

  clearIfApplied(deploymentId: string, applied: boolean): void {
    if (applied) {
      this.clear(deploymentId);
    }
  }

  #pruneExpired(now: number, currentDeploymentId: string): void {
    for (const [deploymentId, retained] of this.#starts) {
      if (deploymentId !== currentDeploymentId && retained.expiresAt <= now) {
        this.#starts.delete(deploymentId);
      }
    }
  }
}

function earliestStart(retainedStartedAt: number | null, observedStartedAt: number | null): number | null {
  if (retainedStartedAt === null) {
    return observedStartedAt;
  }
  if (observedStartedAt === null) {
    return retainedStartedAt;
  }
  return Math.min(retainedStartedAt, observedStartedAt);
}

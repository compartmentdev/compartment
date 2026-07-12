import { KubernetesObjectApi, type KubernetesObject } from '@kubernetes/client-node';
import { vi } from 'vitest';
import {
  calculateKubeStateTransition,
  kubeApplicationName,
  KubeRuntime,
  type KubeDeploymentState,
  type KubeDriftAudit,
  type KubeObservedDeployment,
  type KubeStateTransition,
} from '../src';

export type RecoveryKillPoint =
  | 'after-desired-before-apply'
  | 'after-apply-before-pending'
  | 'after-pending-before-ready'
  | 'during-informer-callback';

interface DurableRuntimeRow {
  audit: KubeDriftAudit[];
  desiredReplicas: number;
  id: string;
  observedAt: Date | null;
  state: KubeDeploymentState;
}

export interface RecoveryResult {
  audit: KubeDriftAudit[];
  objectNames: string[];
  observedAt: Date | null;
  rowCount: number;
  state: KubeDeploymentState;
}

export class KubeRuntimeRecoveryHarness {
  private readonly objectApi: RecoveryObjectApi = new RecoveryObjectApi();
  private readonly runtime: KubeRuntime;
  private readonly objects: Map<string, KubeObservedDeployment> = new Map<string, KubeObservedDeployment>();
  private readonly row: DurableRuntimeRow = {
    audit: [],
    desiredReplicas: 1,
    id: 'dep-01jz',
    observedAt: null,
    state: 'desired',
  };
  private transactions: Promise<void> = Promise.resolve();

  public constructor() {
    vi.spyOn(KubernetesObjectApi, 'makeApiClient').mockReturnValue(this.objectApi as never);
    this.runtime = new KubeRuntime({ makeApiClient: (): object => ({}) } as never);
    this.objectApi.onApply = (deploymentId: string): void => {
      this.objects.set(deploymentId, { ...this.readyObject(), availableReplicas: 0, observedGeneration: 3 });
    };
  }

  public async run(killPoint: RecoveryKillPoint): Promise<RecoveryResult> {
    if (killPoint === 'after-desired-before-apply') await this.restart();
    else if (killPoint === 'after-apply-before-pending') {
      await this.applyBundle();
      await this.restart();
    } else if (killPoint === 'after-pending-before-ready') {
      await this.applyBundle();
      this.row.state = 'pending';
      await this.restart();
    } else {
      await this.applyBundle();
      this.row.state = 'active';
      this.objects.set(this.row.id, { ...this.readyObject(), desiredFieldsDrifted: true });
      await Promise.all([this.reconcile(), this.reconcile(), this.reconcile()]);
    }
    await this.observeReady();
    return {
      audit: [...this.row.audit],
      objectNames: [...this.objects.keys()].map(kubeApplicationName),
      observedAt: this.row.observedAt,
      rowCount: 1,
      state: this.row.state,
    };
  }

  private async restart(): Promise<void> {
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    await this.transaction(async (): Promise<void> => {
      const transition: KubeStateTransition = calculateKubeStateTransition(
        {
          desiredReplicas: this.row.desiredReplicas,
          observedAt: this.row.observedAt,
          state: this.row.state,
        },
        this.objects.get(this.row.id) ?? this.missingObject(),
        new Date('2026-07-11T12:00:00.000Z'),
      );
      if (transition.action === 'apply') await this.applyBundle();
      if (transition.audit !== null && this.row.state === 'active') this.row.audit.push(transition.audit);
      this.row.state = transition.nextState;
      this.row.observedAt = transition.observedAt;
    });
  }

  private async observeReady(): Promise<void> {
    this.objects.set(this.row.id, this.readyObject());
    await this.reconcile();
  }

  private async applyBundle(): Promise<void> {
    await this.runtime.apply({
      objects: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            labels: { 'compartment.dev/deployment-id': this.row.id },
            name: kubeApplicationName(this.row.id),
            namespace: 'cpt-prj-01jz',
          },
        },
      ],
    });
  }

  private readyObject(): KubeObservedDeployment {
    return {
      availableReplicas: 1,
      desiredFieldsDrifted: false,
      exists: true,
      generation: 4,
      observedGeneration: 4,
      requiredObjectsPresent: true,
    };
  }

  private missingObject(): KubeObservedDeployment {
    return {
      availableReplicas: 0,
      desiredFieldsDrifted: false,
      exists: false,
      generation: null,
      observedGeneration: null,
      requiredObjectsPresent: false,
    };
  }

  private async transaction(operation: () => Promise<void>): Promise<void> {
    const current: Promise<void> = this.transactions.then(operation, operation);
    this.transactions = current.catch((): void => undefined);
    await current;
  }
}

class RecoveryObjectApi {
  public onApply: (deploymentId: string) => void = (): void => undefined;

  public async patch(object: KubernetesObject): Promise<KubernetesObject> {
    const deploymentId: string | undefined = object.metadata?.labels?.['compartment.dev/deployment-id'];
    if (deploymentId === undefined) throw new Error('Recovery apply is missing the immutable deployment label.');
    this.onApply(deploymentId);
    return await Promise.resolve(object);
  }
}

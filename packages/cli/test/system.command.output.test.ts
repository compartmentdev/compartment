import { describe, expect, it } from 'vitest';
import type { KubernetesSystemUpdateResponse } from '@compartment/contracts';
import { createKubernetesSystemUpdateMessage } from '../src/commands/system/system.command.output';

describe('system command output', (): void => {
  it('identifies the CLI build and selected platform image version for system updates', (): void => {
    const result: KubernetesSystemUpdateResponse = {
      status: {
        ready: true,
        releaseName: 'compartment',
        releaseStatus: 'deployed',
        workloads: [],
      },
      updated: true,
      version: 'sha-1234567890abcdef',
    };

    const message: string = createKubernetesSystemUpdateMessage(
      result,
      '0.9.2-kubernetes+1234567',
      'Platform readiness: ready.',
    );

    expect(message).toContain('Platform image version selected by CLI 0.9.2-kubernetes+1234567: sha-1234567890abcdef.');
    expect(message).toContain(
      'To deploy a newer platform version, update the CLI with install.sh first, then run compartment system update.',
    );
  });
});

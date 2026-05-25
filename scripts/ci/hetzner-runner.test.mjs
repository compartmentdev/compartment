import { describe, expect, it } from 'vitest';

import {
  buildCreateServerPayload,
  buildFleetRunnerLabel,
  buildFleetServerName,
  buildRunnerInstallScript,
  buildRunnerSlotName,
  calculateFleetServersToCreate,
  calculateBillingPeriodRemainingMs,
  hasOnlineServerRunner,
  hasQueuedJobForRunnerLabels,
  isFleetServerBootstrapExpired,
  isFleetServerUnderCapacity,
  isInsideBillingDeleteWindow,
  rotateFleetLocations,
} from './hetzner-runner.mjs';

const runnerClass = 'hetzner-x86-container-dind-libatomic';

describe('buildRunnerInstallScript', () => {
  it('grants runner slots netfilter management access in their shared DIND namespace', () => {
    const installScript = buildRunnerInstallScript({
      githubRepository: 'compartmentdev/compartment',
      registrationToken: 'registration-token',
      runnerDir: '/actions-runner',
      runnerLabels: `compartment-ci-deploy-e2e,${runnerClass}`,
      runnerName: 'compartment-ci-deploy-e2e-257-1-abcd',
      runnerSlots: 4,
      runnerVersion: 'latest',
    });

    expect(installScript).toContain('--network "container:$dind_name" \\');
    expect(installScript).toContain('--cap-add NET_ADMIN \\');
  });
});

describe('buildFleetRunnerLabel', () => {
  it('builds a stable shared label for a runner pool', () => {
    expect(buildFleetRunnerLabel({ pool: 'Deploy E2E' })).toBe('compartment-ci-deploy-e2e');
  });
});

describe('buildFleetServerName', () => {
  it('builds a Hetzner-safe fleet server name', () => {
    expect(buildFleetServerName({ pool: 'Deploy E2E', suffix: '257-1-abcd' })).toBe(
      'compartment-ci-deploy-e2e-257-1-abcd',
    );
  });
});

describe('buildRunnerSlotName', () => {
  it('adds a stable slot suffix to the fleet server name', () => {
    expect(buildRunnerSlotName({ serverName: 'compartment-ci-deploy-e2e-257-1-abcd', slot: 4 })).toBe(
      'compartment-ci-deploy-e2e-257-1-abcd-s4',
    );
  });
});

describe('rotateFleetLocations', () => {
  it('rotates location attempts so parallel server creates do not all start in one location', () => {
    const locations = ['nbg1', 'fsn1', 'hel1'];

    expect(rotateFleetLocations({ locations, startIndex: 0 })).toEqual(['nbg1', 'fsn1', 'hel1']);
    expect(rotateFleetLocations({ locations, startIndex: 1 })).toEqual(['fsn1', 'hel1', 'nbg1']);
    expect(rotateFleetLocations({ locations, startIndex: 3 })).toEqual(['nbg1', 'fsn1', 'hel1']);
  });
});

describe('buildCreateServerPayload', () => {
  it('builds the Hetzner server payload with runner ownership labels', () => {
    const payload = buildCreateServerPayload({
      fleetLeaseExpiresAt: 1_778_600_000_000,
      fleetPool: 'deploy-e2e',
      fleetSlots: 4,
      githubRepositoryId: '200',
      githubRepositoryOwnerId: '100',
      githubRunAttempt: '1',
      githubRunId: '300',
      image: 'ubuntu-24.04',
      location: 'nbg1',
      runnerClass,
      runnerName: 'compartment-ci-300-1-ingress-build',
      serverType: 'cx43',
      sshKeyIds: ['123'],
      userData: '#cloud-config',
    });

    expect(payload).toMatchObject({
      automount: false,
      image: 'ubuntu-24.04',
      labels: {
        'gh-owner-id': '100',
        'gh-repo-id': '200',
        'gh-run-attempt': '1',
        'gh-run-id': '300',
        'lease-expires-at': '1778600000000',
        'managed-by': 'compartment-ci',
        'runner-class': runnerClass,
        'runner-isolation': 'container-dind',
        'runner-pool': 'deploy-e2e',
        'runner-slots': '4',
        type: 'github-runner',
      },
      location: 'nbg1',
      name: 'compartment-ci-300-1-ingress-build',
      public_net: {
        enable_ipv4: true,
        enable_ipv6: true,
      },
      server_type: 'cx43',
      ssh_keys: ['123'],
      start_after_create: true,
      user_data: '#cloud-config',
    });
  });
});

describe('billing window helpers', () => {
  it('reports the remaining time before the next rounded Hetzner billing hour', () => {
    expect(
      calculateBillingPeriodRemainingMs({
        billingPeriodMs: 60 * 60 * 1000,
        createdAtMs: 0,
        now: 53 * 60 * 1000,
      }),
    ).toBe(7 * 60 * 1000);
  });

  it('detects the delete window before the next rounded Hetzner billing hour', () => {
    expect(
      isInsideBillingDeleteWindow({
        billingDeleteWindowMs: 7 * 60 * 1000,
        billingPeriodMs: 60 * 60 * 1000,
        createdAtMs: 0,
        now: 53 * 60 * 1000,
      }),
    ).toBe(true);

    expect(
      isInsideBillingDeleteWindow({
        billingDeleteWindowMs: 7 * 60 * 1000,
        billingPeriodMs: 60 * 60 * 1000,
        createdAtMs: 0,
        now: 50 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

describe('fleet capacity helpers', () => {
  it('does not create servers above the configured fleet cap', () => {
    expect(
      calculateFleetServersToCreate({
        availableSlots: 0,
        maxServers: 1,
        requestedSlots: 4,
        retainedServerCount: 1,
        runnerSlots: 4,
      }),
    ).toBe(0);
  });
});

describe('fleet runner status helpers', () => {
  it('requires at least one online runner for a server to be considered available', () => {
    const runners = [
      { name: 'compartment-ci-deploy-e2e-257-1-abcd-s1', status: 'offline' },
      { name: 'compartment-ci-deploy-e2e-257-1-abcd-s2', status: 'offline' },
    ];

    expect(hasOnlineServerRunner({ runners, serverName: 'compartment-ci-deploy-e2e-257-1-abcd' })).toBe(false);

    expect(
      hasOnlineServerRunner({
        runners: [...runners, { name: 'compartment-ci-deploy-e2e-257-1-abcd-s3', status: 'online' }],
        serverName: 'compartment-ci-deploy-e2e-257-1-abcd',
      }),
    ).toBe(true);
  });
});

describe('fleet queue helpers', () => {
  it('detects queued jobs that require the Hetzner runner labels', () => {
    expect(
      hasQueuedJobForRunnerLabels({
        jobs: [
          { labels: ['ubuntu-24.04'], status: 'queued' },
          { labels: ['compartment-ci-deploy-e2e', runnerClass], status: 'queued' },
        ],
        requiredLabels: ['compartment-ci-deploy-e2e', runnerClass],
      }),
    ).toBe(true);

    expect(
      hasQueuedJobForRunnerLabels({
        jobs: [{ labels: ['compartment-ci-deploy-e2e', runnerClass], status: 'completed' }],
        requiredLabels: ['compartment-ci-deploy-e2e', runnerClass],
      }),
    ).toBe(false);
  });
});

describe('fleet capacity health helpers', () => {
  it('detects reusable servers with missing online runner slots after bootstrap grace', () => {
    const server = {
      created: '2026-05-12T20:00:00Z',
      labels: {
        'runner-slots': '4',
      },
      name: 'compartment-ci-deploy-e2e-257-1-abcd',
    };
    const runners = [
      { name: 'compartment-ci-deploy-e2e-257-1-abcd-s1', status: 'online' },
      { name: 'compartment-ci-deploy-e2e-257-1-abcd-s2', status: 'offline' },
    ];

    expect(
      isFleetServerUnderCapacity({
        bootstrapGraceMs: 10 * 60 * 1000,
        now: Date.parse('2026-05-12T20:09:59Z'),
        runners,
        server,
      }),
    ).toBe(false);

    expect(
      isFleetServerUnderCapacity({
        bootstrapGraceMs: 10 * 60 * 1000,
        now: Date.parse('2026-05-12T20:10:00Z'),
        runners,
        server,
      }),
    ).toBe(true);
  });
});

describe('fleet bootstrap helpers', () => {
  it('detects stale servers that never registered runner slots', () => {
    const server = { created: '2026-05-12T20:00:00Z' };

    expect(
      isFleetServerBootstrapExpired({
        bootstrapGraceMs: 10 * 60 * 1000,
        now: Date.parse('2026-05-12T20:09:59Z'),
        server,
      }),
    ).toBe(false);

    expect(
      isFleetServerBootstrapExpired({
        bootstrapGraceMs: 10 * 60 * 1000,
        now: Date.parse('2026-05-12T20:10:00Z'),
        server,
      }),
    ).toBe(true);
  });
});

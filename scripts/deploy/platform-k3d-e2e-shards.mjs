const installSuite = 'install';
const buildMatrixSuite = 'build-matrix';
const prLane = 'pr';
const fullLane = 'full';

/**
 * Pull requests run the two shards that prove the product still installs and works end to end;
 * the rest of the matrix runs on main, nightly, and on pull requests that touch the subsystems it
 * covers. Every shard installs through the real CLI, so a shard failure means the installed
 * platform is broken rather than a harness shortcut being out of date.
 */
export const platformK3dShardDefinitions = Object.freeze({
  'pr-product': defineShard(0, [installSuite, 'network-policy', 'system-user', buildMatrixSuite], {
    buildMatrixPartition: 'pr',
    lane: prLane,
  }),
  'pr-console': defineShard(1, [installSuite, 'console'], { lane: prLane }),
  'install-ha-network-policy': defineShard(2, [installSuite, 'ha', 'network-policy'], {
    clusterName: 'compartment-e2e-install-ha-np',
    highAvailability: true,
    installAudit: true,
  }),
  'managed-install': defineShard(3, ['public-operator-install', 'managed-install', 'retained-state']),
  'system-update': defineShard(4, [installSuite, 'system-update']),
  'build-matrix-a': defineShard(5, [installSuite, buildMatrixSuite], { buildMatrixPartition: 'a' }),
  'build-matrix-b': defineShard(6, [installSuite, buildMatrixSuite], {
    buildMatrixPartition: 'b',
    ingressClass: 'nginx',
  }),
  'user-flow': defineShard(7, [installSuite, 'system-user']),
  console: defineShard(8, [installSuite, 'console', 'g1', 'product-log']),
});

assertPlatformK3dShardSecurityModes(platformK3dShardDefinitions);

export const platformK3dShardNames = Object.freeze(Object.keys(platformK3dShardDefinitions));

export const platformK3dPullRequestShardNames = Object.freeze(
  platformK3dShardNames.filter((name) => platformK3dShardDefinitions[name].lane === prLane),
);

/**
 * The full lane supersedes the pull-request lane: its shards cover the same suites without the
 * reduced scope, so escalating a pull request swaps one lane for the other instead of running both.
 */
export const platformK3dFullShardNames = Object.freeze(
  platformK3dShardNames.filter((name) => platformK3dShardDefinitions[name].lane === fullLane),
);

function assertPlatformK3dShardSecurityModes(definitions) {
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.gvisorEnabled !== true) {
      throw new Error(`Platform k3d shard ${name} runs without real gVisor.`);
    }
    const installsPlatform = definition.suites.some((suite) =>
      [installSuite, 'managed-install', 'public-operator-install'].includes(suite),
    );
    if (!installsPlatform) {
      throw new Error(`Platform k3d shard ${name} runs without a production install.`);
    }
  }
}

function defineShard(index, suites, options = {}) {
  return Object.freeze({
    buildMatrixPartition: options.buildMatrixPartition,
    clusterName: options.clusterName,
    gvisorEnabled: true,
    highAvailability: options.highAvailability ?? false,
    index,
    ingressClass: options.ingressClass ?? 'traefik',
    installAudit: options.installAudit ?? false,
    lane: options.lane ?? fullLane,
    suites: Object.freeze(suites),
  });
}

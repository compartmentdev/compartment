const bootstrapSuite = 'bootstrap';
const installSuite = 'install';
const buildMatrixSuite = 'build-matrix';

export const platformK3dShardDefinitions = Object.freeze({
  'managed-install': defineShard(0, ['public-operator-install', 'managed-install', 'retained-state'], {
    gvisorEnabled: true,
  }),
  'install-ha-network-policy': defineShard(1, [installSuite, 'ha', 'network-policy'], {
    clusterName: 'compartment-e2e-install-ha-np',
    gvisorEnabled: true,
    highAvailability: true,
  }),
  'build-matrix-a-1': defineBuildMatrixShard(2, 'a-1'),
  'build-matrix-a-2': defineBuildMatrixShard(3, 'a-2'),
  'build-matrix-b-1': defineBuildMatrixShard(4, 'b-1', 'nginx'),
  'build-matrix-b-2': defineBuildMatrixShard(5, 'b-2', 'nginx'),
  'build-matrix-b-3': defineBuildMatrixShard(6, 'b-3', 'nginx'),
  'gvisor-build': defineShard(7, [installSuite, buildMatrixSuite], {
    buildMatrixPartition: 'gvisor',
    gvisorEnabled: true,
  }),
  'user-flow': defineShard(8, [bootstrapSuite, 'system-user']),
  console: defineShard(9, [bootstrapSuite, 'console', 'g1', 'product-log']),
  'system-update': defineShard(10, [bootstrapSuite, 'system-update']),
});

assertPlatformK3dShardSecurityModes(platformK3dShardDefinitions);

export const platformK3dShardNames = Object.freeze(Object.keys(platformK3dShardDefinitions));

function assertPlatformK3dShardSecurityModes(definitions) {
  for (const [name, definition] of Object.entries(definitions)) {
    const runsProductionInstall = definition.suites.some((suite) =>
      ['install', 'managed-install', 'public-operator-install'].includes(suite),
    );
    const runsHarnessBootstrap = definition.suites.includes(bootstrapSuite);
    if (runsProductionInstall && definition.gvisorEnabled !== true) {
      throw new Error(`Platform k3d shard ${name} runs production install coverage without real gVisor.`);
    }
    if (runsHarnessBootstrap && (definition.gvisorEnabled === true || runsProductionInstall)) {
      throw new Error(`Platform k3d shard ${name} mixes the test bootstrap with production install coverage.`);
    }
  }
}

function defineBuildMatrixShard(index, buildMatrixPartition, ingressClass = 'traefik') {
  return defineShard(index, [bootstrapSuite, buildMatrixSuite], { buildMatrixPartition, ingressClass });
}

function defineShard(index, suites, options = {}) {
  return Object.freeze({
    buildMatrixPartition: options.buildMatrixPartition,
    clusterName: options.clusterName,
    gvisorEnabled: options.gvisorEnabled ?? false,
    highAvailability: options.highAvailability ?? false,
    index,
    ingressClass: options.ingressClass ?? 'traefik',
    suites: Object.freeze(suites),
  });
}

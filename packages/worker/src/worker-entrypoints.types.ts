type WorkerJobEntrypointName = 'awaitResources' | 'build' | 'projectProvisioner';

export type WorkerJobEntrypoints = Readonly<Record<WorkerJobEntrypointName, string>>;

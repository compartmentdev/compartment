import type { ApiApp } from '../../app.types';
import { registerResourceBackupRoutes } from './resource-backup.route';
import { registerPostResourceBootstrapRoute } from './resource-bootstrap.route';
import { registerDeleteResourceRoute } from './resource-delete.route';
import { registerGetResourceListRoute } from './resource-list.route';
import { registerGetResourceLogsRoute } from './resource-logs.route';
import { registerGetResourceRoute } from './resource-get.route';
import { registerPostResourceStartRoute } from './resource-start.route';
import { registerPostResourceStopRoute } from './resource-stop.route';
import { registerPostResourceRestoreRoute } from './resource-restore.route';
import { registerResourceOutputRoutes } from './resource-output.route';

type ResourceRouteRegistrar = (app: ApiApp) => void;

export function registerResourceRoutes(app: ApiApp): void {
  const registrars: ResourceRouteRegistrar[] = [
    registerDeleteResourceRoute,
    registerResourceBackupRoutes,
    registerPostResourceBootstrapRoute,
    registerGetResourceListRoute,
    registerGetResourceLogsRoute,
    registerResourceOutputRoutes,
    registerGetResourceRoute,
    registerPostResourceStartRoute,
    registerPostResourceRestoreRoute,
    registerPostResourceStopRoute,
  ];

  registrars.forEach((register: ResourceRouteRegistrar): void => {
    register(app);
  });
}

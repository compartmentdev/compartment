import type { ApiApp } from '../../app.types';
import { registerDeleteVariableBindingRoute } from './delete-variable-binding.route';
import { registerDeleteVariableRoute } from './delete-variable.route';
import { registerGetVariableGroupListRoute } from './get-variable-group-list.route';
import { registerGetVariableGroupRoute } from './get-variable-group.route';
import { registerGetVariableGroupUsagesRoute } from './get-variable-group-usages.route';
import { registerGetVariableListRoute } from './get-variable-list.route';
import { registerGetVariableRoute } from './get-variable.route';
import { registerPostCaptureVariableGroupRoute } from './post-capture-variable-group.route';
import { registerPostImportVariableGroupRoute } from './post-import-variable-group.route';
import { registerPostImportVariablesRoute } from './post-import-variables.route';
import { registerPostVariableBindingRoute } from './post-variable-binding.route';
import { registerPostVariableGroupRoute } from './post-variable-group.route';
import { registerPostVariableGroupVariableRoute } from './post-variable-group-variable.route';
import { registerPostVariableLocalRunRoute } from './post-variable-local-run.route';
import { registerPostVariableRoute } from './post-variable.route';

type VariableRouteRegistrar = (app: ApiApp) => void;

export function registerVariableRoutes(app: ApiApp): void {
  const registrars: VariableRouteRegistrar[] = [
    registerDeleteVariableBindingRoute,
    registerDeleteVariableRoute,
    registerGetVariableGroupListRoute,
    registerGetVariableGroupUsagesRoute,
    registerGetVariableGroupRoute,
    registerGetVariableListRoute,
    registerGetVariableRoute,
    registerPostCaptureVariableGroupRoute,
    registerPostImportVariableGroupRoute,
    registerPostImportVariablesRoute,
    registerPostVariableBindingRoute,
    registerPostVariableGroupRoute,
    registerPostVariableGroupVariableRoute,
    registerPostVariableLocalRunRoute,
    registerPostVariableRoute,
  ];

  registrars.forEach((register: VariableRouteRegistrar): void => {
    register(app);
  });
}

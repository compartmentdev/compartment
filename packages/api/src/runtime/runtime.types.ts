import type { ApiConfig } from '../config';
import type { Database } from '../db/client';

export interface ApiRuntime {
  config: ApiConfig;
  db: Database;
}

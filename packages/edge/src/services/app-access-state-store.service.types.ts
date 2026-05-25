import type {
  AppAccessGrantState,
  AppAccessRouteState,
  AppAccessSessionState,
  AppAccessStateSnapshot,
} from '@compartment/contracts';

export interface EdgeAppAccessSessionEntry extends AppAccessSessionState {
  token: string;
}

export interface EdgeAppAccessStateStore {
  clearSnapshot(): void;
  clearSession(token: string): void;
  getGrants(principalId: string): AppAccessGrantState[];
  getCompartmentUrl(): string | null;
  getRoute(host: string): AppAccessRouteState | null;
  getSession(token: string): EdgeAppAccessSessionEntry | null;
  hasOnDemandTlsHost(host: string): boolean;
  replaceSnapshot(snapshot: AppAccessStateSnapshot): void;
  revokeAuthSession(authSessionId: string): void;
  setSession(token: string, session: AppAccessSessionState): void;
}

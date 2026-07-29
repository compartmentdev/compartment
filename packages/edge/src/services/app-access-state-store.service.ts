import type {
  AppAccessGrantState,
  AppAccessRouteState,
  AppAccessSessionState,
  AppAccessStateSnapshot,
} from '@compartment/contracts';
import type { EdgeAppAccessSessionEntry, EdgeAppAccessStateStore } from './app-access-state-store.service.types';

export function createEdgeAppAccessStateStore(): EdgeAppAccessStateStore {
  return new InMemoryEdgeAppAccessStateStore();
}

class InMemoryEdgeAppAccessStateStore implements EdgeAppAccessStateStore {
  #compartmentUrl: string | null = null;
  readonly #grantsByPrincipal: Map<string, AppAccessGrantState[]> = new Map<string, AppAccessGrantState[]>();
  readonly #routesByHost: Map<string, AppAccessRouteState> = new Map<string, AppAccessRouteState>();
  readonly #sessionsByToken: Map<string, EdgeAppAccessSessionEntry> = new Map<string, EdgeAppAccessSessionEntry>();

  clearSnapshot(): void {
    this.#compartmentUrl = null;
    this.#grantsByPrincipal.clear();
    this.#routesByHost.clear();
    this.#sessionsByToken.clear();
  }

  clearSession(token: string): void {
    this.#sessionsByToken.delete(token);
  }

  getGrants(principalId: string): AppAccessGrantState[] {
    return this.#grantsByPrincipal.get(principalId) ?? [];
  }

  getCompartmentUrl(): string | null {
    return this.#compartmentUrl;
  }

  getRoute(host: string): AppAccessRouteState | null {
    return this.#routesByHost.get(host) ?? null;
  }

  getSession(token: string): EdgeAppAccessSessionEntry | null {
    return this.#sessionsByToken.get(token) ?? null;
  }

  replaceSnapshot(snapshot: AppAccessStateSnapshot): void {
    this.#compartmentUrl = snapshot.compartmentUrl;
    this.#grantsByPrincipal.clear();
    for (const grant of snapshot.grants) {
      const currentGrants: AppAccessGrantState[] = this.#grantsByPrincipal.get(grant.principalId) ?? [];
      this.#grantsByPrincipal.set(grant.principalId, [...currentGrants, grant]);
    }

    this.#routesByHost.clear();
    for (const route of snapshot.routes) {
      this.#routesByHost.set(route.host, route);
    }
  }

  revokeAuthSession(authSessionId: string): void {
    for (const [token, session] of this.#sessionsByToken.entries()) {
      if (session.authSessionId === authSessionId) {
        this.#sessionsByToken.delete(token);
      }
    }
  }

  setSession(token: string, session: AppAccessSessionState): void {
    this.#sessionsByToken.set(token, {
      ...session,
      token,
    });
  }
}

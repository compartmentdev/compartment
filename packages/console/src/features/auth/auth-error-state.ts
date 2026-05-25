export interface AuthErrorState {
  id: number;
  message?: string | undefined;
}

export function createAuthErrorState(message: string | undefined): AuthErrorState {
  return {
    id: 0,
    message,
  };
}

export function readNextAuthErrorState(current: AuthErrorState, message: string | undefined): AuthErrorState {
  return {
    id: current.id + 1,
    message,
  };
}

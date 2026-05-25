import { useEffect, type CSSProperties, type JSX } from 'react';

interface AuthLoadingScreenProps {
  redirectTo?: string | undefined;
}

const loadingLogoPaths: readonly string[] = [
  'M29.4922 54.8887L20.5459 60L11.5996 54.8887L20.5459 49.7774L29.4922 54.8887Z',
  'M40.7042 49.3499V59.5756L31.746 54.4553V44.2296L40.7042 49.3499Z',
  'M51.157 54.4553L42.1987 59.5756V49.3499L51.157 44.2296V54.4553Z',
  'M19.8016 48.4801L10.8434 53.6004V43.3778L19.8016 38.2605V48.4801Z',
  'M60.8446 36.9722L51.9013 42.0805L42.955 36.9692L51.9013 31.8609L60.8446 36.9722Z',
  'M9.35181 31.4334V41.6561L0.393555 36.5388V26.3131L9.35181 31.4334Z',
  'M30.2514 31.4334V41.6561L21.2962 36.5358V26.3131L30.2514 31.4334Z',
  'M40.7012 36.5358L31.746 41.6561V31.4334L40.7012 26.3131V36.5358Z',
  'M61.6068 25.4612V35.6839L52.6486 30.5636V20.3439L61.6068 25.4612Z',
  'M19.0424 25.0278L10.0961 30.1391L1.14979 25.0248L10.0961 19.9165L19.0424 25.0278Z',
  'M39.942 25.0278L30.9957 30.1391L22.0524 25.0248L30.9957 19.9165L39.942 25.0278Z',
  'M51.157 18.6163L42.1987 23.7365V13.5169L51.157 8.39662V18.6163Z',
  'M19.8016 12.6471L10.8434 17.7674V7.54473L19.8016 2.42445V12.6471Z',
  'M30.2514 7.54174V17.7674L21.2962 12.6471V2.42445L30.2514 7.54174Z',
  'M50.3948 7.11132L41.4485 12.2226L32.5022 7.10833L41.4485 2L50.3948 7.11132Z',
];

export function AuthLoadingScreen({ redirectTo }: Readonly<AuthLoadingScreenProps>): JSX.Element {
  useAuthRedirectNavigation(redirectTo);

  return (
    <div className="auth-loading-screen">
      <svg
        aria-hidden="true"
        className="auth-loading-logo"
        fill="none"
        viewBox="0 0 62 62"
        xmlns="http://www.w3.org/2000/svg"
      >
        {loadingLogoPaths.map(
          (path: string, index: number): JSX.Element => (
            <path className="auth-loading-logo__path" d={path} key={path} style={buildLoadingPathStyle(index)} />
          ),
        )}
      </svg>
      <span className="sr-only">Loading</span>
    </div>
  );
}

function useAuthRedirectNavigation(redirectTo: string | undefined): void {
  useEffect((): (() => void) | undefined => {
    if (redirectTo === undefined) {
      return undefined;
    }

    const timeoutId: number = window.setTimeout((): void => {
      window.location.assign(redirectTo);
    }, 180);

    return (): void => {
      window.clearTimeout(timeoutId);
    };
  }, [redirectTo]);
}

function buildLoadingPathStyle(index: number): CSSProperties {
  return {
    '--auth-loading-delay': `${(index * 0.08).toFixed(2)}s`,
  } as CSSProperties;
}

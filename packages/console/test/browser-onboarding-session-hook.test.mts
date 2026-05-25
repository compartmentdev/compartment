import type * as ReactModule from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { OnboardingRouteNavigate } from '../src/features/onboarding/onboarding-page.types';
import { createDefaultOnboardingRouteState } from '../src/features/onboarding/onboarding-route-state';
import {
  useEnsureOnboardingSession,
  type OnboardingSessionIssue,
} from '../src/features/onboarding/onboarding-navigation';

type ReactModuleType = typeof ReactModule;
type OnboardingEffect = () => void | (() => void);
type OnboardingStateSetter = ReactModule.Dispatch<ReactModule.SetStateAction<string | null>>;
type OnboardingApiMock = () => Promise<void>;

interface ReactMockState {
  setState: Mock<OnboardingStateSetter>;
  useEffect: Mock<(effect: OnboardingEffect) => void>;
}

interface OnboardingApiMockState {
  createBrowserFirstDeployOnboardingSession: Mock<OnboardingApiMock>;
  patchBrowserFirstDeployOnboardingSession: Mock<OnboardingApiMock>;
  readBrowserFirstDeployOnboardingSession: Mock<OnboardingApiMock>;
}

const reactMocks: ReactMockState = vi.hoisted(
  (): ReactMockState => ({
    setState: vi.fn<OnboardingStateSetter>(),
    useEffect: vi.fn<(effect: OnboardingEffect) => void>((effect: OnboardingEffect): void => {
      effect();
    }),
  }),
);

const onboardingApiMocks: OnboardingApiMockState = vi.hoisted(
  (): OnboardingApiMockState => ({
    createBrowserFirstDeployOnboardingSession: vi.fn<OnboardingApiMock>(),
    patchBrowserFirstDeployOnboardingSession: vi.fn<OnboardingApiMock>(),
    readBrowserFirstDeployOnboardingSession: vi.fn<OnboardingApiMock>(),
  }),
);

vi.mock('react', async (importOriginal: () => Promise<ReactModuleType>): Promise<ReactModuleType> => {
  const actual: ReactModuleType = await importOriginal();
  return createReactModuleMock(actual);
});

vi.mock('../src/features/onboarding/onboarding-api', (): OnboardingApiMockState => onboardingApiMocks);

function createReactModuleMock(actual: ReactModuleType): ReactModuleType {
  const reactModuleMock: ReactModuleType = Object.create(actual) as ReactModuleType;
  Object.defineProperty(reactModuleMock, 'useEffect', { value: reactMocks.useEffect });
  Object.defineProperty(reactModuleMock, 'useState', { value: readMockUseState });
  return reactModuleMock;
}

function readMockUseState<SValue>(
  initialState: SValue | (() => SValue),
): [SValue, ReactModule.Dispatch<ReactModule.SetStateAction<SValue>>];
function readMockUseState<SValue = undefined>(): [
  SValue | undefined,
  ReactModule.Dispatch<ReactModule.SetStateAction<SValue | undefined>>,
];
function readMockUseState<SValue>(
  initialState?: SValue | (() => SValue),
): [SValue | undefined, ReactModule.Dispatch<ReactModule.SetStateAction<SValue | undefined>>] {
  const value: SValue | undefined =
    typeof initialState === 'function' ? (initialState as () => SValue)() : initialState;
  const setState: ReactModule.Dispatch<ReactModule.SetStateAction<SValue | undefined>> = (): void => {
    reactMocks.setState(null);
  };
  return [value, setState];
}

describe('browser onboarding session hook', (): void => {
  beforeEach((): void => {
    reactMocks.setState.mockClear();
    reactMocks.useEffect.mockClear();
    onboardingApiMocks.createBrowserFirstDeployOnboardingSession.mockClear();
    onboardingApiMocks.patchBrowserFirstDeployOnboardingSession.mockClear();
    onboardingApiMocks.readBrowserFirstDeployOnboardingSession.mockClear();
  });

  it('does not prepare or patch a first-deploy session without selected organization context', (): void => {
    const navigate: OnboardingRouteNavigate = vi.fn<OnboardingRouteNavigate>();

    const issue: OnboardingSessionIssue | null = useEnsureOnboardingSession(
      null,
      {
        ...createDefaultOnboardingRouteState(),
        method: 'cli',
        sessionId: 'fdo_123',
        step: 'prepare',
      },
      navigate,
    );

    expect(issue).toBeNull();
    expect(reactMocks.setState).toHaveBeenCalledWith(null);
    expect(onboardingApiMocks.createBrowserFirstDeployOnboardingSession).not.toHaveBeenCalled();
    expect(onboardingApiMocks.patchBrowserFirstDeployOnboardingSession).not.toHaveBeenCalled();
    expect(onboardingApiMocks.readBrowserFirstDeployOnboardingSession).not.toHaveBeenCalled();
  });
});

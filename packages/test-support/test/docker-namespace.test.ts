import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanupDockerTestNamespacesByPrefix, createDockerTestNamespace } from '../src/docker-namespace';
import type { DockerNamespaceContainer, DockerNamespaceImage } from '../src/docker-namespace.adapter.types';

type ListDockerNamespaceContainers = (labelName: string, labelValue: string) => Promise<DockerNamespaceContainer[]>;
type ListDockerNamespaceImages = (labelName: string, labelValue: string) => Promise<DockerNamespaceImage[]>;
type ListDockerNetworkNames = () => Promise<string[]>;
type SingleStringCall = [string];
type RemoveDockerNamespaceContainer = (containerId: string) => Promise<void>;
type RemoveDockerNamespaceImage = (imageId: string) => Promise<void>;
type RemoveDockerNamespaceNetwork = (networkName: string) => Promise<void>;
type RemoveDockerNamespaceVolume = (volumeName: string) => Promise<void>;

interface DockerNamespaceAdapterMocks {
  listDockerNamespaceContainers: Mock<ListDockerNamespaceContainers>;
  listDockerNamespaceImages: Mock<ListDockerNamespaceImages>;
  listDockerNetworkNames: Mock<ListDockerNetworkNames>;
  removeDockerNamespaceContainer: Mock<RemoveDockerNamespaceContainer>;
  removeDockerNamespaceImage: Mock<RemoveDockerNamespaceImage>;
  removeDockerNamespaceNetwork: Mock<RemoveDockerNamespaceNetwork>;
  removeDockerNamespaceVolume: Mock<RemoveDockerNamespaceVolume>;
}

const mocks: DockerNamespaceAdapterMocks = vi.hoisted(
  (): DockerNamespaceAdapterMocks => ({
    listDockerNamespaceContainers: vi.fn<ListDockerNamespaceContainers>(),
    listDockerNamespaceImages: vi.fn<ListDockerNamespaceImages>(),
    listDockerNetworkNames: vi.fn<ListDockerNetworkNames>(),
    removeDockerNamespaceContainer: vi.fn<RemoveDockerNamespaceContainer>(),
    removeDockerNamespaceImage: vi.fn<RemoveDockerNamespaceImage>(),
    removeDockerNamespaceNetwork: vi.fn<RemoveDockerNamespaceNetwork>(),
    removeDockerNamespaceVolume: vi.fn<RemoveDockerNamespaceVolume>(),
  }),
);

vi.mock(
  '../src/docker-namespace.adapter',
  (): {
    listDockerNamespaceContainers: Mock<ListDockerNamespaceContainers>;
    listDockerNamespaceImages: Mock<ListDockerNamespaceImages>;
    listDockerNetworkNames: Mock<ListDockerNetworkNames>;
    removeDockerNamespaceContainer: Mock<RemoveDockerNamespaceContainer>;
    removeDockerNamespaceImage: Mock<RemoveDockerNamespaceImage>;
    removeDockerNamespaceNetwork: Mock<RemoveDockerNamespaceNetwork>;
    removeDockerNamespaceVolume: Mock<RemoveDockerNamespaceVolume>;
  } => ({
    listDockerNamespaceContainers: mocks.listDockerNamespaceContainers,
    listDockerNamespaceImages: mocks.listDockerNamespaceImages,
    listDockerNetworkNames: mocks.listDockerNetworkNames,
    removeDockerNamespaceContainer: mocks.removeDockerNamespaceContainer,
    removeDockerNamespaceImage: mocks.removeDockerNamespaceImage,
    removeDockerNamespaceNetwork: mocks.removeDockerNamespaceNetwork,
    removeDockerNamespaceVolume: mocks.removeDockerNamespaceVolume,
  }),
);

afterEach((): void => {
  mocks.listDockerNamespaceContainers.mockReset();
  mocks.listDockerNamespaceImages.mockReset();
  mocks.listDockerNetworkNames.mockReset();
  mocks.removeDockerNamespaceContainer.mockReset();
  mocks.removeDockerNamespaceImage.mockReset();
  mocks.removeDockerNamespaceNetwork.mockReset();
  mocks.removeDockerNamespaceVolume.mockReset();
});

describe('createDockerTestNamespace', (): void => {
  it('sanitizes the prefix and appends a short random suffix', (): void => {
    const namespace: string = createDockerTestNamespace('Compartment E2E');

    expect(namespace).toMatch(/^compartment-e2e-[a-f0-9]{8}$/u);
  });
});

describe('cleanupDockerTestNamespacesByPrefix', (): void => {
  it('cleans matching Docker test namespaces through the typed adapter', async (): Promise<void> => {
    const networkNames: string[] = [
      'compartment-compartment-e2e-11111111-production-web',
      'compartment-e2e-11111111_system_internal',
      'compartment-compartment-e2e-22222222-production-api',
      'unrelated-network',
    ];
    const firstNamespaceContainers: DockerNamespaceContainer[] = [
      {
        containerId: 'release-container',
        imageId: 'sha256:release-image',
        labels: {
          'compartment.namespace': 'compartment-e2e-11111111',
        },
      },
      {
        containerId: 'registry-container',
        imageId: 'sha256:registry-image',
        labels: {
          'compartment.component': 'artifact-registry',
          'compartment.namespace': 'compartment-e2e-11111111',
        },
      },
    ];
    const secondNamespaceContainers: DockerNamespaceContainer[] = [
      {
        containerId: 'api-container',
        imageId: 'sha256:api-image',
        labels: {
          'compartment.namespace': 'compartment-e2e-22222222',
        },
      },
    ];
    const firstNamespaceImages: DockerNamespaceImage[] = [{ imageId: 'sha256:labeled-image' }];
    const secondNamespaceImages: DockerNamespaceImage[] = [];
    mocks.listDockerNetworkNames
      .mockResolvedValueOnce(networkNames)
      .mockResolvedValueOnce(networkNames)
      .mockResolvedValueOnce(networkNames);
    mocks.listDockerNamespaceContainers
      .mockResolvedValueOnce(firstNamespaceContainers)
      .mockResolvedValueOnce(secondNamespaceContainers);
    mocks.listDockerNamespaceImages
      .mockResolvedValueOnce(firstNamespaceImages)
      .mockResolvedValueOnce(secondNamespaceImages);
    mocks.removeDockerNamespaceContainer.mockResolvedValue(undefined);
    mocks.removeDockerNamespaceNetwork.mockResolvedValue(undefined);
    mocks.removeDockerNamespaceVolume.mockResolvedValue(undefined);
    mocks.removeDockerNamespaceImage.mockResolvedValue(undefined);

    await cleanupDockerTestNamespacesByPrefix('Compartment E2E');

    expectCallSet(mocks.removeDockerNamespaceContainer.mock.calls, [
      ['release-container'],
      ['registry-container'],
      ['api-container'],
    ]);
    expectCallSet(mocks.removeDockerNamespaceNetwork.mock.calls, [
      ['compartment-compartment-e2e-11111111-production-web'],
      ['compartment-e2e-11111111_system_internal'],
      ['compartment-compartment-e2e-22222222-production-api'],
    ]);
    expectCallSet(mocks.removeDockerNamespaceVolume.mock.calls, [
      ['compartment-e2e-11111111-artifact-registry-data'],
      ['compartment-e2e-22222222-artifact-registry-data'],
    ]);
    expectCallSet(mocks.removeDockerNamespaceImage.mock.calls, [
      ['sha256:api-image'],
      ['sha256:labeled-image'],
      ['sha256:release-image'],
    ]);
  });
});

function expectCallSet(actualCalls: SingleStringCall[], expectedCalls: SingleStringCall[]): void {
  expect(actualCalls.map(serializeCall).sort(compareSerializedCalls)).toEqual(
    expectedCalls.map(serializeCall).sort(compareSerializedCalls),
  );
}

function serializeCall(call: SingleStringCall): string {
  return JSON.stringify(call);
}

function compareSerializedCalls(left: string, right: string): number {
  return left.localeCompare(right);
}

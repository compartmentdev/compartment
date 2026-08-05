import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanManagedVmArtifacts,
  downloadManagedVmArtifacts,
  type ManagedVmDownloadedArtifacts,
} from '../src/services/managed-vm-artifacts.service';
import type { ManagedVmArtifact, ManagedVmArtifactName } from '../src/services/managed-vm-provisioning.types';
import { digest } from '../src/services/managed-vm-state.service';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('managed VM artifacts', (): void => {
  it('rejects unverified bytes before an artifact can be installed', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response('unexpected bytes')),
    );
    const artifact: ManagedVmArtifact = {
      name: 'k3s',
      sha256: '0'.repeat(64),
      url: 'https://releases.example.test/k3s',
      version: 'v1.35.5+k3s1',
    };
    await expect(downloadManagedVmArtifacts([artifact])).rejects.toThrow('k3s digest verification failed');
  });

  it('extracts verified gVisor artifacts without a host bzip2 executable', async (): Promise<void> => {
    const executableDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-artifact-path-'));
    const originalPath: string | undefined = process.env.PATH;
    await symlink('/usr/bin/tar', join(executableDirectory, 'tar'));
    await symlink('/usr/bin/gzip', join(executableDirectory, 'gzip'));
    process.env.PATH = executableDirectory;
    const artifacts: readonly ManagedVmArtifact[] = createArtifacts();
    stubArtifactDownloads(artifacts);
    let downloaded: ManagedVmDownloadedArtifacts | undefined;
    try {
      downloaded = await downloadManagedVmArtifacts(artifacts);
      await expect(readFile(downloaded.gvisorRunscPath, 'utf8')).resolves.toBe('runsc\n');
      await expect(readFile(downloaded.gvisorContainerdShimPath, 'utf8')).resolves.toBe('shim\n');
      await expect(readFile(join(downloaded.gvisorBinDirectory, 'marker'), 'utf8')).resolves.toBe('bundle\n');
      expect((await stat(downloaded.gvisorRunscPath)).mode & 0o777).toBe(0o755);
    } finally {
      process.env.PATH = originalPath;
      if (downloaded !== undefined) {
        await cleanManagedVmArtifacts(downloaded);
      }
      await rm(executableDirectory, { force: true, recursive: true });
    }
  });
});

function createArtifacts(): readonly ManagedVmArtifact[] {
  const payloads: Readonly<Record<ManagedVmArtifactName, Buffer>> = artifactPayloads();
  return Object.entries(payloads).map(
    ([name, bytes]: [string, Buffer]): ManagedVmArtifact => ({
      name: name as ManagedVmArtifactName,
      sha256: digest(bytes),
      url: `https://artifacts.example.test/${name}`,
      version: 'test',
    }),
  );
}

function stubArtifactDownloads(artifacts: readonly ManagedVmArtifact[]): void {
  const payloads: Readonly<Record<ManagedVmArtifactName, Buffer>> = artifactPayloads();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string): Response => {
      const artifact: ManagedVmArtifact | undefined = artifacts.find(
        (item: ManagedVmArtifact): boolean => item.url === url,
      );
      return artifact === undefined
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array(payloads[artifact.name]));
    }),
  );
}

function artifactPayloads(): Readonly<Record<ManagedVmArtifactName, Buffer>> {
  return {
    'cert-manager': Buffer.from('cert-manager'),
    gvisor: Buffer.from(gvisorArchiveBase64, 'base64'),
    helm: Buffer.from(helmArchiveBase64, 'base64'),
    k3s: Buffer.from('k3s'),
    'k3s-install-script': Buffer.from('install'),
  };
}

const helmArchiveBase64: string =
  'H4sIAHHucmoAA+2W3UrDMBTHoyDiRLxSvMwL2CVtPtoLL+oHbDBRp4iCIKGLdLjOWTvp9Al8A+99RR/A1g1X67QK7USbHxxOGvJxkvLPOdp5p93th+vCazECigEhxCmFr54NPdLJ0A/bBsRUNwhlHDMMEaaMYABRQfG8o38TCD8KpeW1A3/Qla4YOG778sO4aNjFxRfrDI8C3/xfYW51HswCsCscuHcIT+CIuA8sRKZHdh1Z/P30vSXto6PmqBnPeIxsMTVkZty/4lx5muj1OlLr+Ve3siu6jgQzs+B+7Wz54e55KYdDKj5jX4Q1KVrSrxb3DmTqH/GU/rnBKYBhznFMpOT61y3oBW1PbmBuUgtzRLBmcMvUddOqUA4b9U27uVWrH+9ooQgCX5uk1g37oG7L0HW2SYdZNqoQCx5GkxqnX01KSLzy29dQWhKqrxa1R5b+Y72k8j/hHEBaVEBJSq7/5P/Xzl3Z8fLfI7oPRshP6j9GmaHqv6mg6r9Sk9T/uBbM9x3I1D9Ovf86MjBW9d80MNCE+s9EJsIWJaoA/Pck9V9M9s/WP0I0nf8Noqv8Pw3if67Ep1AoFOXjBepR1L4AGgAA';

const gvisorArchiveBase64: string =
  'QlpoOTFBWSZTWR87ww0AAdr/8P+6g8BQA//jP2b/fP/v/3gAIABADgAE2FADPgAAADjQ0DRpkaaNMgMTBAADQGgNMgMCZBxoaBo0yNNGmQGJggABoDQGmQGBMg40NA0aZGmjTIDEwQAA0BoDTIDAmQcaGgaNMjTRpkBiYIAAaA0BpkBgTICpRAQUelP00T0ImmMo0NNPU9RoDQekzU2ptT1Biaemmp85mPKTjJ/pvc1HLV5K9qvUU/w+Dfolp75KTcNxKlOc0mo9gqDeKEm+UNJ2C8sQNsoiVKCHnN0qdooE2Ox3/jqpNVKXGoJuEqYEoIzCiIzlDwFCdcXCVMCo6Ck3ylprN3n2bjwaKacSe0UJyChwFCf8NkmJKExiVpKUimwTyl8nCTNTcp1tda41qvtPeOI4y4uG6mqc0wmU6fd3+rAmI3Ccp+R4JbKU25O9sBPwKm0WAmkTxEoTky+PP5ePyejk5PPy5yd3QJUnZ4tolO6XU4LNu+6FlayJ0SlbL6FlVGBKkqb5RwmUqvpdxFb8SXktL93NfeTOdRkwJQ8xmxvuJSF1Y0Itykur9xfymxnWYkrOPIZM1t2UTCtsspS4mUv/YwZNFYYYkvssqTLPWdddmwyYGJjnrdUl9l2EtoS+/G8qYGBTBOAmznNRynnPQOE8xwn8GScw8x8h3TgF3ZMxVKnO4qWeE+EofEXltpaVwLTIWJzDfKk+U1nRJOIlxKk+maR/J6yf0ng6D1FJaZSdJPSZxr9XT45lMfCTuHDEoaSh2y4niJ6Zxlk7Z6SZiaNGja71d4m6aCazWG8exM80pqJ0E1zhNrpJadJNWqlhcTgKppJnJs9slsrJkmzJNlOuTrExJ75O8ZpYTFNQsksl5NGxn19yYk7Mllk2E5yXk2CXyhNsxF5M40TXpkr7SZ5pJ0p2DE2htFSZCdQyj3ChPcUJ1CiH/i7kinChID53hho=';

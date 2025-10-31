export interface NpmVersionMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface NpmPackageMetadata {
  name: string;
  versions: Record<string, NpmVersionMetadata>;
  'dist-tags': Record<string, string>;
}

const registryBaseUrl = 'https://registry.npmjs.org';
const metadataCache = new Map<string, NpmPackageMetadata>();

async function fetchPackageFromRegistry(pkgName: string): Promise<NpmPackageMetadata> {
  const response = await fetch(`${registryBaseUrl}/${pkgName}`);
  if (!response.ok) {
    throw new Error(`No se pudo consultar ${pkgName}: ${response.status}`);
  }
  return (await response.json()) as NpmPackageMetadata;
}

export async function getPackageMetadata(pkgName: string): Promise<NpmPackageMetadata> {
  if (metadataCache.has(pkgName)) {
    return metadataCache.get(pkgName)!;
  }

  try {
    const metadata = await fetchPackageFromRegistry(pkgName);
    metadataCache.set(pkgName, metadata);
    return metadata;
  } catch (error) {
    console.error('Error al consultar el registro de NPM', error);
    throw error;
  }
}

export function primePackageCache(pkgName: string, metadata: NpmPackageMetadata): void {
  metadataCache.set(pkgName, metadata);
}

export function clearPackageCache(): void {
  metadataCache.clear();
}

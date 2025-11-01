import { PackageDefinition } from '../lib/VersionResolver';

function extractDependencies(source: Record<string, unknown>, key: keyof PackageDefinition): Record<string, string> {
  const value = source[key];
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function normalizePackageDefinition(input: Record<string, unknown>): PackageDefinition {
  const dependencies = extractDependencies(input, 'dependencies');
  const devDependencies = extractDependencies(input, 'devDependencies');
  return { dependencies, devDependencies };
}

export function sanitizePackageName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

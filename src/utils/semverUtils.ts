import semver, { SemVer } from 'semver';

export type VersionIssueType = 'outdated' | 'duplicate' | 'conflict' | 'error' | 'vulnerable' | 'advice';

export interface VersionIssue {
  type: VersionIssueType;
  message: string;
  affectedVersions?: string[];
}

export interface SemverResolution {
  declaredRange: string;
  resolvedVersion: string | null;
  latestVersion: string | null;
  issues: VersionIssue[];
}

export function findMaxSatisfying(range: string, versions: string[]): string | null {
  if (!range || versions.length === 0) {
    return null;
  }

  const normalized = normalizeRange(range);
  const satisfying = semver.maxSatisfying(versions, normalized, { includePrerelease: false });
  return satisfying ?? null;
}

export function normalizeRange(range: string): string {
  try {
    const cleaned = range.trim();
    if (cleaned === '' || cleaned === '*') {
      return '*';
    }

    // semver.validRange already handles ^ ~ >= etc.
    const valid = semver.validRange(cleaned);
    return valid ?? cleaned;
  } catch (error) {
    console.warn('Could not normalize range', range, error);
    return range;
  }
}

export function compareVersions(a?: string | null, b?: string | null): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  if (semver.eq(a, b)) {
    return 0;
  }
  return semver.gt(a, b) ? 1 : -1;
}

export function isOutdated(resolved: string | null, latest: string | null): boolean {
  if (!resolved || !latest) {
    return false;
  }

  try {
    return semver.lt(new SemVer(resolved), new SemVer(latest));
  } catch (error) {
    console.warn('Could not compare versions', resolved, latest, error);
    return false;
  }
}

export function formatVersionLabel(resolved: string | null, latest: string | null): string {
  if (!resolved && !latest) {
    return 'sin datos';
  }
  if (!resolved) {
    return `no resuelta (última ${latest ?? 'desconocida'})`;
  }
  if (!latest || resolved === latest) {
    return resolved;
  }
  return `${resolved} (última ${latest})`;
}

export function describeRange(range: string): string {
  const normalized = normalizeRange(range);
  if (normalized === '*') {
    return 'Acepta cualquier versión disponible.';
  }
  if (normalized.startsWith('^')) {
    return 'Permite actualizaciones menores y de parches dentro de la misma versión mayor.';
  }
  if (normalized.startsWith('~')) {
    return 'Permite actualizaciones de parches dentro de la misma versión menor.';
  }
  if (/^>=/.test(normalized)) {
    return 'Acepta cualquier versión mayor o igual al mínimo indicado.';
  }
  if (/^\d/.test(normalized)) {
    return 'Bloquea la dependencia a una versión exacta.';
  }
  return `Rango personalizado (${normalized}).`;
}

export function buildRangeAdvice(
  range: string,
  resolvedVersion: string | null,
  latestVersion: string | null,
): VersionIssue[] {
  const normalized = normalizeRange(range);
  const issues: VersionIssue[] = [];
  const preferredVersion = resolvedVersion ?? latestVersion ?? null;

  if (normalized === '*') {
    issues.push({
      type: 'advice',
      message: preferredVersion
        ? `El rango abierto '*' permite cualquier versión. Cambia a ^${preferredVersion} para acotar las actualizaciones.`
        : "El rango abierto '*' permite cualquier versión. Cambia a un rango acotado (^ o ~) para mejorar la reproducibilidad.",
    });
    return issues;
  }

  const normalizedVersion = semver.valid(normalized) ? normalized : null;

  if (normalizedVersion && preferredVersion) {
    issues.push({
      type: 'advice',
      message: `El rango fija la versión exacta ${normalizedVersion}. Cambia a ^${preferredVersion} para seguir recibiendo parches compatibles.`,
    });
  }

  if (normalized.startsWith('~') && preferredVersion) {
    issues.push({
      type: 'advice',
      message: `El rango ${normalized} solo acepta parches. Considera ^${preferredVersion} para incluir actualizaciones menores seguras.`,
    });
  }

  if (normalized.startsWith('>=')) {
    const minimum = normalized.replace(/^>=\s*/, '');
    if (preferredVersion && semver.valid(minimum)) {
      issues.push({
        type: 'advice',
        message: `El rango ${normalized} permite saltos mayores potencialmente incompatibles. Limita a ^${preferredVersion} para mantener estabilidad.`,
      });
    }
  }

  if (normalized.startsWith('^') && latestVersion && resolvedVersion && semver.valid(latestVersion) && semver.valid(resolvedVersion)) {
    const resolvedMajor = semver.major(resolvedVersion);
    const latestMajor = semver.major(latestVersion);
    if (latestMajor > resolvedMajor) {
      issues.push({
        type: 'advice',
        message: `Hay una nueva versión mayor disponible (${latestVersion}). Evalúa actualizar el rango a ^${latestVersion} tras revisar cambios incompatibles.`,
      });
    }
  }

  return issues;
}

export function collectDuplicateIssues(resolvedVersions: Record<string, Set<string>>): Record<string, VersionIssue[]> {
  return Object.entries(resolvedVersions).reduce<Record<string, VersionIssue[]>>((acc, [pkg, versions]) => {
    if (versions.size > 1) {
      const versionList = Array.from(versions);
      const sorted = versionList
        .filter((version) => semver.valid(version))
        .sort((a, b) => semver.rcompare(a, b));

      const issues: VersionIssue[] = [
        {
          type: 'duplicate',
          message: `Se detectaron múltiples versiones instaladas: ${versionList.join(', ')}`,
          affectedVersions: versionList,
        },
      ];

      const recommended = sorted[0];
      if (recommended) {
        issues.push({
          type: 'advice',
          message: `Actualiza los manifiestos a ^${recommended} para unificar las ${versions.size} variantes detectadas.`,
        });
      }

      acc[pkg] = issues;
    }
    return acc;
  }, {});
}

export function mergeIssues(existing: VersionIssue[] = [], incoming: VersionIssue[] = []): VersionIssue[] {
  if (!incoming.length) {
    return existing;
  }
  const merged = [...existing];
  incoming.forEach((issue) => {
    if (!merged.find((item) => item.type === issue.type && item.message === issue.message)) {
      merged.push(issue);
    }
  });
  return merged;
}

export function summarizeIssues(issues: VersionIssue[]): string {
  if (!issues.length) {
    return 'Sin incidencias conocidas.';
  }
  return issues.map((issue) => `• ${issue.message}`).join('\n');
}

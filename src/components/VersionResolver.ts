import { getPackageMetadata, NpmVersionMetadata } from '../utils/npmApi';
import {
  SemverResolution,
  buildRangeAdvice,
  collectDuplicateIssues,
  describeRange,
  findMaxSatisfying,
  formatVersionLabel,
  isOutdated,
  mergeIssues,
  VersionIssue,
} from '../utils/semverUtils';
import { getCriticalVulnerabilityIssues } from '../utils/vulnerabilityService';

export interface DependencyEdge {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
}

export interface DependencyNode extends SemverResolution {
  name: string;
  nodeId: string;
  rangeDescription: string;
  children: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyGraphResult {
  tree: DependencyNode[];
  edges: DependencyEdge[];
  duplicates: Record<string, VersionIssue[]>;
}

export interface ResolveOptions {
  includeDev?: boolean;
  includePeer?: boolean;
  maxDepth?: number;
}

export interface PackageDefinition {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ResolveContext {
  options: Required<ResolveOptions>;
  visited: Map<string, Set<string>>;
  edges: DependencyEdge[];
}

const defaultOptions: Required<ResolveOptions> = {
  includeDev: false,
  includePeer: true,
  maxDepth: 6,
};

export async function resolvePackageGraph(pkg: PackageDefinition, options?: ResolveOptions): Promise<DependencyGraphResult> {
  const normalized: Required<ResolveOptions> = { ...defaultOptions, ...options };
  const visited = new Map<string, Set<string>>();
  const edges: DependencyEdge[] = [];

  const rootDeps = pkg.dependencies ?? {};
  const devDeps = normalized.includeDev ? pkg.devDependencies ?? {} : {};
  const combined = { ...rootDeps, ...devDeps };

  const tree: DependencyNode[] = [];

  for (const [name, range] of Object.entries(combined)) {
    const node = await resolveDependency(name, range, 0, { options: normalized, visited, edges });
    tree.push(node);
  }

  const duplicates = computeDuplicateIssues(visited);
  applyDuplicateIssues(tree, duplicates);

  return { tree, edges, duplicates };
}

async function resolveDependency(
  name: string,
  declaredRange: string,
  depth: number,
  context: ResolveContext,
): Promise<DependencyNode> {
  const issues: VersionIssue[] = [];
  const rangeDescription = describeRange(declaredRange);

  if (depth > context.options.maxDepth) {
    return {
      name,
      nodeId: `${name}@depth-limit`,
      declaredRange,
      resolvedVersion: null,
      latestVersion: null,
      issues: [
        {
          type: 'error',
          message: 'Se alcanzó el límite máximo de profundidad configurado.',
        },
      ],
      rangeDescription,
      children: [],
      edges: [],
    };
  }

  try {
    const metadata = await getPackageMetadata(name);
    const availableVersions = Object.keys(metadata.versions ?? {});
    const resolvedVersion = findMaxSatisfying(declaredRange, availableVersions);
    const latestVersion = metadata['dist-tags']?.latest ?? null;

    if (!resolvedVersion) {
      issues.push({
        type: 'conflict',
        message: 'No hay ninguna versión que cumpla el rango declarado.',
      });
    }

    const duplicateSet = context.visited.get(name) ?? new Set<string>();
    if (resolvedVersion) {
      duplicateSet.add(resolvedVersion);
      context.visited.set(name, duplicateSet);
    }

    const nodeId = resolvedVersion ? `${name}@${resolvedVersion}` : `${name}@unknown`;

    let versionMetadata: NpmVersionMetadata | undefined;
    let children: DependencyNode[] = [];
    if (resolvedVersion) {
      versionMetadata = metadata.versions?.[resolvedVersion];
      if (versionMetadata) {
        children = await resolveNestedDependencies(nodeId, name, versionMetadata, depth + 1, context);
      }
    }

    const vulnerabilityIssues = resolvedVersion
      ? await getCriticalVulnerabilityIssues(name, resolvedVersion)
      : [];
    if (vulnerabilityIssues.length) {
      issues.push(...vulnerabilityIssues);
    }

    issues.push(...buildRangeAdvice(declaredRange, resolvedVersion, latestVersion));

    if (isOutdated(resolvedVersion, latestVersion)) {
      issues.push({
        type: 'outdated',
        message: `Hay una versión más reciente disponible (${formatVersionLabel(resolvedVersion, latestVersion)}).`,
      });
    }

    if (versionMetadata?.deprecated) {
      issues.push({
        type: 'vulnerable',
        message: `Versión marcada como obsoleta: ${versionMetadata.deprecated}`,
      });
    }

    return {
      name,
      nodeId,
      declaredRange,
      resolvedVersion,
      latestVersion,
      issues,
      rangeDescription,
      children,
      edges: context.edges.filter((edge) => edge.from === nodeId),
    };
  } catch (error) {
    issues.push({
      type: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido al resolver la dependencia.',
    });

    return {
      name,
      nodeId: `${name}@unknown`,
      declaredRange,
      resolvedVersion: null,
      latestVersion: null,
      issues,
      rangeDescription,
      children: [],
      edges: context.edges.filter((edge) => edge.from === `${name}@unknown`),
    };
  }
}

async function resolveNestedDependencies(
  parentId: string,
  parentName: string,
  versionMetadata: NpmVersionMetadata,
  depth: number,
  context: ResolveContext,
): Promise<DependencyNode[]> {
  const dependencies = versionMetadata.dependencies ?? {};
  const peerDependencies = context.options.includePeer ? versionMetadata.peerDependencies ?? {} : {};

  const children: DependencyNode[] = [];

  const combinedEntries = Object.entries({ ...dependencies, ...peerDependencies });

  for (const [depName, depRange] of combinedEntries) {
    const childNode = await resolveDependency(depName, depRange, depth, context);
    context.edges.push({ from: parentId, to: childNode.nodeId, fromLabel: parentName, toLabel: depName });
    children.push(childNode);
  }

  return children;
}

function computeDuplicateIssues(visited: Map<string, Set<string>>): Record<string, VersionIssue[]> {
  return collectDuplicateIssues(Object.fromEntries(visited.entries()));
}

function applyDuplicateIssues(tree: DependencyNode[], duplicates: Record<string, VersionIssue[]>): void {
  const apply = (node: DependencyNode): DependencyNode => {
    const duplicateIssues = duplicates[node.name] ?? [];
    node.issues = mergeIssues(node.issues, duplicateIssues);
    node.children = node.children.map(apply);
    return node;
  };

  tree.forEach(apply);
}

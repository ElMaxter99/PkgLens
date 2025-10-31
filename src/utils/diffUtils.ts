import { DependencyGraphResult, DependencyNode, PackageDefinition } from '../components/VersionResolver';

type SectionKey = 'dependencies' | 'devDependencies';

export interface DependencyDiffSummary {
  added: number;
  removed: number;
  changed: number;
}

export interface IssueDiffSummary {
  introduced: number;
  resolved: number;
  baselineTotal: number;
  targetTotal: number;
}

function cloneEntries(source: PackageDefinition | null, includeDev: boolean): Record<string, string> {
  if (!source) {
    return {};
  }

  const base = { ...(source.dependencies ?? {}) };
  if (includeDev) {
    Object.assign(base, source.devDependencies ?? {});
  }
  return base;
}

export function diffPackageDependencies(
  baseline: PackageDefinition | null,
  target: PackageDefinition | null,
  includeDev: boolean,
): DependencyDiffSummary {
  const baselineEntries = cloneEntries(baseline, includeDev);
  const targetEntries = cloneEntries(target, includeDev);

  let added = 0;
  let removed = 0;
  let changed = 0;

  const baselineKeys = new Set(Object.keys(baselineEntries));
  const targetKeys = new Set(Object.keys(targetEntries));

  targetKeys.forEach((name) => {
    if (!baselineKeys.has(name)) {
      added += 1;
      return;
    }
    if (baselineEntries[name] !== targetEntries[name]) {
      changed += 1;
    }
  });

  baselineKeys.forEach((name) => {
    if (!targetKeys.has(name)) {
      removed += 1;
    }
  });

  return { added, removed, changed };
}

function collectIssuesFromNode(node: DependencyNode, bucket: Set<string>): void {
  node.issues.forEach((issue) => {
    bucket.add(`${node.nodeId}::${issue.type}::${issue.message}`);
  });
  node.children.forEach((child) => collectIssuesFromNode(child, bucket));
}

function collectIssues(result: DependencyGraphResult | null): Set<string> {
  const bucket = new Set<string>();
  if (!result) {
    return bucket;
  }
  result.tree.forEach((node) => collectIssuesFromNode(node, bucket));
  return bucket;
}

export function diffIssueSummary(
  baseline: DependencyGraphResult | null,
  target: DependencyGraphResult | null,
): IssueDiffSummary | null {
  if (!baseline && !target) {
    return null;
  }

  const baselineIssues = collectIssues(baseline);
  const targetIssues = collectIssues(target);

  let resolved = 0;
  baselineIssues.forEach((issue) => {
    if (!targetIssues.has(issue)) {
      resolved += 1;
    }
  });

  let introduced = 0;
  targetIssues.forEach((issue) => {
    if (!baselineIssues.has(issue)) {
      introduced += 1;
    }
  });

  return {
    introduced,
    resolved,
    baselineTotal: baselineIssues.size,
    targetTotal: targetIssues.size,
  };
}

export function mergePackageDefinitions(
  target: PackageDefinition | null,
  updates: Partial<Record<SectionKey, Record<string, string>>>,
): PackageDefinition | null {
  if (!target) {
    return null;
  }

  const next: PackageDefinition = {
    dependencies: { ...(target.dependencies ?? {}) },
    devDependencies: { ...(target.devDependencies ?? {}) },
  };

  (Object.keys(updates) as SectionKey[]).forEach((section) => {
    const value = updates[section];
    if (!value) {
      return;
    }
    next[section] = value;
  });

  if (Object.keys(next.dependencies ?? {}).length === 0) {
    delete next.dependencies;
  }
  if (Object.keys(next.devDependencies ?? {}).length === 0) {
    delete next.devDependencies;
  }

  return next;
}


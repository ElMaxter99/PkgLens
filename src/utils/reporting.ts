import {
  DependencyGraphResult,
  DependencyNode,
  DependencyEdge,
} from '../lib/VersionResolver';
import { VersionIssue, VersionIssueType } from './semverUtils';

export type ReportFormat = 'json' | 'markdown';

export interface ReportMetadata {
  includeDev?: boolean;
  includePeer?: boolean;
  maxDepth?: number;
  source?: string;
  packageName?: string;
  generatedAt?: string;
}

export interface IssueReportEntry {
  packageName: string;
  nodeId: string;
  type: VersionIssueType;
  message: string;
  path: string;
}

export interface AnalysisReportSummary {
  directDependencies: number;
  totalNodes: number;
  uniquePackages: number;
  leafNodes: number;
  maxDepth: number;
  dependencyEdges: number;
  totalIssues: number;
  issuesByType: Record<VersionIssueType, number>;
  duplicatePackages: number;
}

export interface AnalysisReport {
  formatVersion: string;
  metadata: {
    generatedAt: string;
    includeDev: boolean;
    includePeer: boolean;
    maxDepth: number;
    source?: string;
    packageName?: string;
  };
  summary: AnalysisReportSummary;
  topIssues: IssueReportEntry[];
  duplicates: Record<string, VersionIssue[]>;
  tree: DependencyNode[];
  edges: DependencyEdge[];
}

const ISSUE_SORT_ORDER: VersionIssueType[] = ['vulnerable', 'error', 'conflict', 'outdated', 'duplicate', 'advice'];

const ISSUE_LABELS: Record<VersionIssueType, string> = {
  vulnerable: 'Vulnerabilidad',
  error: 'Error',
  conflict: 'Conflicto',
  outdated: 'Dependencia desactualizada',
  duplicate: 'Duplicado',
  advice: 'Recomendación',
};

export function createAnalysisReport(
  result: DependencyGraphResult,
  metadata: ReportMetadata = {},
): AnalysisReport {
  const generatedAt = metadata.generatedAt ?? new Date().toISOString();
  const includeDev = metadata.includeDev ?? false;
  const includePeer = metadata.includePeer ?? true;
  const maxDepth = metadata.maxDepth ?? 6;

  const issuesByType = ISSUE_SORT_ORDER.reduce<Record<VersionIssueType, number>>((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {} as Record<VersionIssueType, number>);

  let totalNodes = 0;
  let leafNodes = 0;
  let maxEncounteredDepth = 0;
  const uniquePackages = new Set<string>();
  const issueEntries: IssueReportEntry[] = [];

  const visit = (nodes: DependencyNode[], depth: number, parentPath: string) => {
    nodes.forEach((node) => {
      totalNodes += 1;
      uniquePackages.add(node.name);
      const currentPath = parentPath ? `${parentPath} › ${node.name}` : node.name;
      if (node.children.length === 0) {
        leafNodes += 1;
      }
      if (depth > maxEncounteredDepth) {
        maxEncounteredDepth = depth;
      }
      node.issues.forEach((issue) => {
        const currentCount = issuesByType[issue.type];
        issuesByType[issue.type] = typeof currentCount === 'number' ? currentCount + 1 : 1;
        issueEntries.push({
          packageName: node.name,
          nodeId: node.nodeId,
          type: issue.type,
          message: issue.message,
          path: currentPath,
        });
      });
      if (node.children.length) {
        visit(node.children, depth + 1, currentPath);
      }
    });
  };

  visit(result.tree, 1, '');

  const totalIssues = issueEntries.length;
  const duplicatePackages = Object.keys(result.duplicates ?? {}).length;

  const sortedIssues = issueEntries.slice().sort((a, b) => {
    const rankA = ISSUE_SORT_ORDER.indexOf(a.type);
    const rankB = ISSUE_SORT_ORDER.indexOf(b.type);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    if (a.packageName !== b.packageName) {
      return a.packageName.localeCompare(b.packageName);
    }
    return a.message.localeCompare(b.message);
  });

  const summary: AnalysisReportSummary = {
    directDependencies: result.tree.length,
    totalNodes,
    uniquePackages: uniquePackages.size,
    leafNodes,
    maxDepth: maxEncounteredDepth,
    dependencyEdges: result.edges.length,
    totalIssues,
    issuesByType,
    duplicatePackages,
  };

  return {
    formatVersion: '1.0.0',
    metadata: {
      generatedAt,
      includeDev,
      includePeer,
      maxDepth,
      source: metadata.source,
      packageName: metadata.packageName,
    },
    summary,
    topIssues: sortedIssues.slice(0, 12),
    duplicates: result.duplicates,
    tree: result.tree,
    edges: result.edges,
  };
}

export function formatAnalysisReportAsMarkdown(report: AnalysisReport): string {
  const lines: string[] = [];
  const sourceLabel = report.metadata.source ?? 'Análisis manual';
  const packageLabel = report.metadata.packageName ? ` (${report.metadata.packageName})` : '';

  lines.push(`# Informe de dependencias - ${sourceLabel}${packageLabel}`);
  lines.push('');
  lines.push(`- Generado: ${report.metadata.generatedAt}`);
  lines.push(`- Incluye devDependencies: ${report.metadata.includeDev ? 'Sí' : 'No'}`);
  lines.push(`- Incluye peerDependencies: ${report.metadata.includePeer ? 'Sí' : 'No'}`);
  lines.push(`- Límite de profundidad consultado: ${report.metadata.maxDepth}`);
  lines.push(`- Paquetes directos analizados: ${report.summary.directDependencies}`);
  lines.push('');

  lines.push('## Resumen ejecutivo');
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('| --- | --- |');
  lines.push(`| Nodos totales | ${report.summary.totalNodes} |`);
  lines.push(`| Paquetes únicos | ${report.summary.uniquePackages} |`);
  lines.push(`| Hojas del árbol | ${report.summary.leafNodes} |`);
  lines.push(`| Profundidad máxima | ${report.summary.maxDepth} |`);
  lines.push(`| Relaciones (edges) | ${report.summary.dependencyEdges} |`);
  lines.push(`| Incidencias totales | ${report.summary.totalIssues} |`);
  lines.push(`| Paquetes duplicados | ${report.summary.duplicatePackages} |`);
  lines.push('');

  lines.push('## Incidencias por tipo');
  lines.push('');
  lines.push('| Tipo | Total |');
  lines.push('| --- | --- |');
  ISSUE_SORT_ORDER.forEach((type) => {
    const label = ISSUE_LABELS[type] ?? type;
    const count = report.summary.issuesByType[type] ?? 0;
    lines.push(`| ${label} | ${count} |`);
  });
  lines.push('');

  lines.push('## Incidencias destacadas');
  lines.push('');
  if (report.topIssues.length === 0) {
    lines.push('No se registraron incidencias para las dependencias analizadas.');
  } else {
    report.topIssues.forEach((issue) => {
      const label = ISSUE_LABELS[issue.type] ?? issue.type;
      lines.push(`- **${label}** en \`${issue.path}\`: ${issue.message}`);
    });
  }
  lines.push('');

  lines.push('## Duplicados detectados');
  lines.push('');
  const duplicateEntries = Object.entries(report.duplicates);
  if (!duplicateEntries.length) {
    lines.push('No se detectaron paquetes duplicados en el árbol de dependencias.');
  } else {
    duplicateEntries.forEach(([pkgName, issues]) => {
      lines.push(`- **${pkgName}**`);
      issues.forEach((issue) => {
        lines.push(`  - ${issue.message}`);
      });
    });
  }
  lines.push('');

  lines.push('> Informe generado automáticamente con PkgLens. Integra este resultado en tus pipelines y Pull Requests para monitorear la salud de tus dependencias.');

  return lines.join('\n');
}

export { ISSUE_SORT_ORDER as REPORT_ISSUE_TYPES, ISSUE_LABELS as REPORT_ISSUE_LABELS };
